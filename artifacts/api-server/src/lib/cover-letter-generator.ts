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
  const candidateLocation = `${profile?.city || "Nairobi"}, ${profile?.country || "Kenya"}`;

  // 1. Read all candidate documents for rich context
  const dossier = await loadAllCandidateDocumentContext(storageDir);
  const candidateEducation = dossier.educationText || profile?.education?.[0] || "";

  const jobTitle = job?.title?.trim() || "Technology Professional";
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

  // 2. Try Connected AI Provider (Gemini / OpenAI / OpenRouter)
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
      const model = settings.model || (provider === "agentrouter" ? "gpt-4o-mini" : "gemini-3.6-flash");

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

    if (process.env.GEMINI_API_KEY) {
      const aiResult = await generateCoverLetterWithAi(
        dossier.summaryText || `Candidate Name: ${candidateName}, Education: ${candidateEducation}`,
        job,
        { ...extractedDetails, refCode },
        profile,
        "gemini",
        process.env.GEMINI_API_KEY,
        "gemini-3.6-flash",
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

  const isItSupportRole = /\b(it|ict|support|helpdesk|service\s*desk|system|network|technician|administrator|noc|infrastructure)\b/i.test(jobTitle);
  const isSoftwareRole = /\b(software|developer|engineer|frontend|fullstack|full-stack|web|react|node|python|backend|javascript|typescript)\b/i.test(jobTitle);
  const isDatabaseRole = /\b(database|sql|data|dba|analyst)\b/i.test(jobTitle);

  const suggestedCategories: string[] = ["cv"];
  if (extractedDetails?.whatToAttach) {
    for (const doc of extractedDetails.whatToAttach) {
      const docLower = doc.toLowerCase();
      if (docLower.includes("diploma") || docLower.includes("degree") || docLower.includes("transcript") || docLower.includes("academic") || docLower.includes("certificate")) {
        suggestedCategories.push("academic_diploma");
      }
      if (docLower.includes("national id") || docLower.includes("id card") || docLower.includes("identity") || docLower.includes("copy of id")) {
        suggestedCategories.push("national_id");
      }
      if (docLower.includes("ccna") || docLower.includes("itil") || docLower.includes("cisco") || docLower.includes("certification") || docLower.includes("professional certificate")) {
        suggestedCategories.push("professional_certification");
      }
      if (docLower.includes("kcse")) {
        suggestedCategories.push("kcse_certificate");
      }
      if (docLower.includes("recommendation") || docLower.includes("testimonial") || docLower.includes("referee")) {
        suggestedCategories.push("recommendation_letter");
      }
    }
  }

  let openingParagraph = "";
  let skillsParagraph = "";
  let closingParagraph = "";

  if (isItSupportRole) {
    openingParagraph = `I am writing to express my strong interest in the ${jobTitle} position at ${companyName}. With a solid background in Computer Science (${candidateEducation}) and practical hands-on experience in IT systems administration, network setup (LAN/WAN), hardware troubleshooting, and technical support, I am eager to contribute to your technical operations.`;
    skillsParagraph = `In my technical background, I have developed strong competencies in diagnosing and resolving hardware, software, and network incidents, maintaining Windows and Linux environments, managing user accounts, and ensuring seamless operational uptime. My technical skill set includes Cisco networking principles (CCNA preparation), ITIL service management practices, Active Directory fundamentals, database queries, and cybersecurity awareness. I pride myself on responsive communication, high attention to detail, and methodical incident escalation.`;
  } else if (isSoftwareRole) {
    openingParagraph = `I am writing to enthusiastically apply for the ${jobTitle} position at ${companyName}. Having completed my ${candidateEducation} and built modern full-stack web applications utilizing React.js, Node.js, Python, PostgreSQL, REST APIs, and Supabase, I am excited about the prospect of bringing my engineering skills to your team.`;
    skillsParagraph = `My practical software development background includes building responsive user interfaces with modern React, developing secure backend APIs, managing database schemas, and applying clean coding principles with Git version control. I approach engineering with a problem-solving mindset, a dedication to high-performance code, and the agility to quickly master new frameworks, libraries, and architectural requirements.`;
  } else if (isDatabaseRole) {
    openingParagraph = `I am writing to formally submit my application for the ${jobTitle} position at ${companyName}. With specialized training in ${candidateEducation} and practical experience in relational database design, SQL querying, PostgreSQL, and data management, I am confident in my ability to support your data operations.`;
    skillsParagraph = `My experience includes optimizing relational data structures, writing robust queries, database backup and recovery procedures, and integrating database systems with modern web applications. I am committed to maintaining data integrity, system security, and reliable performance across operational databases.`;
  } else {
    openingParagraph = `I am writing to formally submit my application for the ${jobTitle} role at ${companyName}. With a background in Computer Science (${candidateEducation}) and a versatile technical skill set spanning IT systems support, software development, and technical troubleshooting, I am well-prepared to deliver immediate value to your organization.`;
    skillsParagraph = `Throughout my technical education and project engagements, I have demonstrated a strong ability to analyze complex technical requirements, collaborate effectively with team members, and deliver reliable solutions under deadlines. My core strengths include rapid technical problem diagnosis, software tools proficiency, and a steadfast commitment to continuous improvement.`;
  }

  const attachedList: string[] = ["Curriculum Vitae (CV)"];
  if (suggestedCategories.includes("academic_diploma") || dossier.documentCategories.includes("academic_diploma")) attachedList.push("Academic Diploma & Transcripts");
  if (suggestedCategories.includes("national_id") || dossier.documentCategories.includes("national_id")) attachedList.push("Copy of National ID");
  if (suggestedCategories.includes("professional_certification") || dossier.documentCategories.includes("professional_certification")) attachedList.push("Professional Certifications (CCNA/ITIL)");
  if (suggestedCategories.includes("kcse_certificate") || dossier.documentCategories.includes("kcse_certificate")) attachedList.push("KCSE Certificate");
  if (suggestedCategories.includes("recommendation_letter") || dossier.documentCategories.includes("recommendation_letter")) attachedList.push("Letters of Recommendation");

  closingParagraph = `I have attached my ${Array.from(new Set(attachedList)).join(", ")} for your review. I welcome the opportunity to discuss in an interview how my technical skills and dedication can support the strategic goals of ${companyName}.\n\nThank you for your time and consideration.`;

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
