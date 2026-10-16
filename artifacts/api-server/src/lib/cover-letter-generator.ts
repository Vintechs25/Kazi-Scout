/**
 * Automated Cover Letter & Application Package Generator
 * Reads ALL candidate uploaded documents (CV, Diplomas, National ID, Certs)
 * and leverages connected AI (Gemini / OpenAI) to generate deeply tailored packages.
 */

import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { cvsTable, db, integrationSettingsTable, systemStateTable } from "@workspace/db";
import { extractCvText } from "./cv-text-extraction";
import { decryptCredentials } from "./credential-encryption";
import { generateCoverLetterWithAi, type AiProvider } from "./provider-services";

export interface GeneratedApplicationPackage {
  subject: string;
  recipientEmail: string;
  coverLetter: string;
  suggestedDocumentCategories: string[];
}

export interface CandidateDossier {
  summaryText: string;
  documentCategories: string[];
  educationText: string;
  skillsText: string;
  experienceText: string;
}

/**
 * Reads and extracts text from ALL candidate documents in storage
 */
export async function loadAllCandidateDocumentContext(storageDir: string): Promise<CandidateDossier> {
  const allDocs = await db.select().from(cvsTable);
  const docSnippets: string[] = [];
  const categories: string[] = [];
  let educationFound = "";
  let skillsFound = "";

  for (const doc of allDocs) {
    const cat = (doc as any).category || "cv";
    categories.push(cat);
    let text = (doc.extractedText || "").trim();

    if (!text) {
      let fileBuffer: Buffer | null = null;
      const filePath = path.resolve(storageDir, doc.storageName);
      if (fs.existsSync(filePath)) {
        try {
          fileBuffer = fs.readFileSync(filePath);
        } catch {}
      } else if (doc.fileData) {
        try {
          fileBuffer = Buffer.from(doc.fileData, "base64");
        } catch {}
      }

      if (fileBuffer) {
        try {
          const res = await extractCvText(fileBuffer, doc.fileType as any);
          text = (res?.text || "").trim();
        } catch (err) {
          console.warn(`[DocumentContext] Failed to read ${doc.fileName}:`, err);
        }
      }
    }

    if (text) {
      docSnippets.push(`--- DOCUMENT: ${doc.fileName} (Category: ${cat.toUpperCase()}) ---\n${text.slice(0, 8000)}`);
      if (!educationFound) {
        const eduLine = text
          .split("\n")
          .find((l) => /diploma|bachelor|degree|master|doctor|phd|fellowship|mbbs|fwacs|university|college|academy/i.test(l) && l.trim().length > 5 && l.trim().length < 140);
        if (eduLine) {
          educationFound = eduLine.trim();
        }
      }
    }
  }

  return {
    summaryText: docSnippets.join("\n\n"),
    documentCategories: Array.from(new Set(categories)),
    educationText: educationFound || "",
    skillsText: skillsFound,
    experienceText: "",
  };
}

export async function generateTailoredCoverLetter(
  profile: any,
  job: any,
  extractedDetails: any,
  storageDir: string
): Promise<GeneratedApplicationPackage> {
  const candidateName = profile?.fullName?.trim() || "Candidate";
  const candidateEmail = profile?.email?.trim() || "";
  const candidatePhone = profile?.phone?.trim() || "";
  const candidateLocation = [profile?.city, profile?.country].filter(Boolean).join(", ") || "Remote";

  // 1. Read all candidate documents for rich context
  const dossier = await loadAllCandidateDocumentContext(storageDir);
  const candidateEducation = dossier.educationText || profile?.education?.[0] || "";

  const jobTitle = job?.title?.trim() || "Professional Opportunity";
  const companyName = job?.company?.trim() || "Hiring Organization";

  // Extract clean Job Reference Code if present (e.g. DC/IT/01, REF: 2026/04, HR-09)
  let refCode: string | null = null;
  const rawDesc = String(job?.description || "");
  const refMatch = rawDesc.match(
    /(?:job\s*ref(?:erence)?(?:\s*no\.?|\s*number|\s*code)?|ref\s*no\.?|reference\s*no\.?|vacancy\s*no\.?)[:\s*#]+([A-Za-z0-9\/_\.-]{3,30})/i
  );
  if (refMatch && refMatch[1]) {
    const rawRef = refMatch[1].replace(/^[#:\s]+/, "").trim();
    if (rawRef.length >= 3 && !/^(the|and|for|with|of|all|are)$/i.test(rawRef)) {
      refCode = rawRef;
    }
  }

  // 2. Try Connected AI Provider (Agent Router / Gemini / OpenAI / OpenRouter)
  try {
    const [allIntegrations, [state]] = await Promise.all([
      db.select().from(integrationSettingsTable).where(eq(integrationSettingsTable.status, "CONNECTED")),
      db.select().from(systemStateTable).where(eq(systemStateTable.id, "agent")).limit(1),
    ]);
    const defaultPref = state?.defaultAiProvider || "auto";

    // Sort providers according to default preference
    const sorted = [...allIntegrations].sort((a, b) => {
      if (defaultPref !== "auto") {
        if (a.provider === defaultPref) return -1;
        if (b.provider === defaultPref) return 1;
      }
      return 0;
    });

    for (const settings of sorted) {
      const provider = settings.provider as AiProvider;
      const apiKey = settings.encryptedCredentials
        ? decryptCredentials<{ apiKey?: string }>(settings.encryptedCredentials)?.apiKey
        : undefined;
      const model = settings.model || (provider === "agentrouter" ? "gpt-4o-mini" : "gemini-2.0-flash");

      if (provider && apiKey) {
        const aiResult = await generateCoverLetterWithAi(
          dossier.summaryText || `Candidate Name: ${candidateName}, Education: ${candidateEducation}`,
          job,
          { ...extractedDetails, refCode },
          profile,
          provider,
          apiKey,
          model,
          settings.baseUrl,
        );

        if (aiResult && aiResult.coverLetter) {
          return {
            subject: aiResult.subject,
            recipientEmail: aiResult.recipientEmail || extractedDetails?.applyEmail || "",
            coverLetter: aiResult.coverLetter,
            suggestedDocumentCategories: aiResult.suggestedDocumentCategories,
          };
        }
      }
    }

    // Environment fallbacks
    const envApiKey = process.env.AGENTROUTER_API_KEY || process.env.AGENT_ROUTER_API_KEY;
    if (envApiKey) {
      const aiResult = await generateCoverLetterWithAi(
        dossier.summaryText || `Candidate Name: ${candidateName}, Education: ${candidateEducation}`,
        job,
        { ...extractedDetails, refCode },
        profile,
        "agentrouter",
        envApiKey,
        process.env.AGENTROUTER_MODEL || "gpt-4o-mini",
        process.env.AGENTROUTER_BASE_URL || "https://agentrouter.org/v1",
      );
      if (aiResult?.coverLetter) {
        return {
          subject: aiResult.subject,
          recipientEmail: aiResult.recipientEmail || extractedDetails?.applyEmail || "",
          coverLetter: aiResult.coverLetter,
          suggestedDocumentCategories: aiResult.suggestedDocumentCategories,
        };
      }
    }

    if (process.env.GEMINI_API_KEY) {
      const aiResult = await generateCoverLetterWithAi(
        dossier.summaryText || `Candidate Name: ${candidateName}, Education: ${candidateEducation}`,
        job,
        { ...extractedDetails, refCode },
        profile,
        "gemini",
        process.env.GEMINI_API_KEY,
        "gemini-2.0-flash",
      );

      if (aiResult && aiResult.coverLetter) {
        return {
          subject: aiResult.subject,
          recipientEmail: aiResult.recipientEmail || extractedDetails?.applyEmail || "",
          coverLetter: aiResult.coverLetter,
          suggestedDocumentCategories: aiResult.suggestedDocumentCategories,
        };
      }
    }
  } catch (err) {
    console.warn("[generateTailoredCoverLetter] AI provider pass error, falling back to contextual generator:", err);
  }

  // 3. Fallback: Contextual deterministic generator using full document facts
  let subject = "";
  if (refCode) {
    subject = `Application for ${jobTitle} (Ref: ${refCode}) - ${candidateName}`;
  } else if (companyName && companyName !== "Hiring Organization" && !jobTitle.toLowerCase().includes(companyName.toLowerCase())) {
    subject = `Application for ${jobTitle} - ${companyName} - ${candidateName}`;
  } else {
    subject = `Application for ${jobTitle} - ${candidateName}`;
  }

  const recipientEmail = extractedDetails?.applyEmail || "";

  const suggestedCategories: string[] = ["cv"];
  if (extractedDetails?.whatToAttach) {
    for (const doc of extractedDetails.whatToAttach) {
      const docLower = doc.toLowerCase();
      if (docLower.includes("diploma") || docLower.includes("degree") || docLower.includes("transcript") || docLower.includes("academic") || docLower.includes("certificate")) {
        suggestedCategories.push("academic_diploma");
      }
      if (docLower.includes("national id") || docLower.includes("id card") || docLower.includes("identity") || docLower.includes("passport")) {
        suggestedCategories.push("national_id");
      }
      if (docLower.includes("certification") || docLower.includes("license") || docLower.includes("licensure") || docLower.includes("fellowship")) {
        suggestedCategories.push("professional_certification");
      }
      if (docLower.includes("recommendation") || docLower.includes("testimonial") || docLower.includes("referee")) {
        suggestedCategories.push("recommendation_letter");
      }
    }
  }

  const candidateSkills = Array.isArray(profile?.skills) && profile.skills.length > 0
    ? profile.skills.slice(0, 6).join(", ")
    : "proven professional competencies, rigorous operational governance, and collaborative teamwork";

  const candidateCerts = Array.isArray(profile?.certifications) && profile.certifications.length > 0
    ? profile.certifications.slice(0, 3).join(", ")
    : "";

  const eduMention = candidateEducation ? ` (supported by ${candidateEducation})` : "";
  const certMention = candidateCerts ? ` alongside verified credentials in ${candidateCerts}` : "";

  const openingParagraph = `I am writing to formally submit my application for the ${jobTitle} position at ${companyName}. With extensive professional experience in my field${eduMention}${certMention}, I am eager to deliver immediate value to your organization and contribute meaningfully to your strategic goals.`;

  const skillsParagraph = `Throughout my career, I have developed comprehensive capabilities including ${candidateSkills}. I approach my duties with a strong commitment to quality standards, meticulous attention to detail, evidence-based execution, and continuous professional growth. Whether engaging directly with stakeholders, analyzing complex domain problems, or leading multidisciplinary initiatives, I consistently prioritize operational excellence, responsiveness, and ethical practice.`;

  const attachedList: string[] = ["Curriculum Vitae (CV)"];
  if (suggestedCategories.includes("academic_diploma") || dossier.documentCategories.includes("academic_diploma")) attachedList.push("Academic Credentials & Transcripts");
  if (suggestedCategories.includes("national_id") || dossier.documentCategories.includes("national_id")) attachedList.push("Identification Document");
  if (suggestedCategories.includes("professional_certification") || dossier.documentCategories.includes("professional_certification")) attachedList.push("Professional Certifications / Licenses");
  if (suggestedCategories.includes("recommendation_letter") || dossier.documentCategories.includes("recommendation_letter")) attachedList.push("Letters of Recommendation");

  const closingParagraph = `I have attached my ${Array.from(new Set(attachedList)).join(", ")} for your review. I would welcome the opportunity to discuss in an interview how my professional background, competencies, and dedication directly align with the strategic objectives of ${companyName}.\n\nThank you for your time, consideration, and review.`;

  const coverLetter = `Dear Hiring Team,

${openingParagraph}

${skillsParagraph}

${closingParagraph}

Sincerely,
${candidateName}
${candidatePhone}
${candidateEmail}
${candidateLocation}`;

  return {
    subject,
    recipientEmail,
    coverLetter,
    suggestedDocumentCategories: Array.from(new Set(suggestedCategories)),
  };
}
