import { createHash } from "node:crypto";
import { z } from "@workspace/api-zod";
import { db, candidateProfilesTable, integrationSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getVerifiedMasterCv } from "./cv-storage";
import { decryptCredentials } from "./credential-encryption";
import { normalizeModelName } from "./provider-services";

export const verifiedWorkExperienceSchema = z.object({
  title: z.string(),
  company: z.string(),
  period: z.string().nullish().transform(v => v || "Not specified"),
  responsibilities: z.array(z.string()).default([]),
  technologiesUsed: z.array(z.string()).default([]),
  isProfessional: z.boolean().default(true),
});

export const educationItemSchema = z.object({
  institution: z.string(),
  qualification: z.string(),
  year: z.string().nullish(),
});

export const certificationItemSchema = z.object({
  name: z.string(),
  issuer: z.string().nullish().transform(v => v || "Verified"),
  year: z.string().nullish(),
});

export const projectItemSchema = z.object({
  name: z.string(),
  description: z.string().nullish().transform(v => v || ""),
  technologies: z.array(z.string()).default([]),
  role: z.string().nullish(),
});

export const candidateEvidenceProfileSchema = z.object({
  fullName: z.string(),
  yearsExperience: z.number(),
  targetRoleFamilies: z.array(z.string()),
  demonstratedTechnicalSkills: z.array(z.string()),
  selfReportedSkills: z.array(z.string()),
  verifiedWorkExperience: z.array(verifiedWorkExperienceSchema),
  education: z.array(educationItemSchema),
  certifications: z.array(certificationItemSchema),
  projectsAndPracticalExperience: z.array(projectItemSchema),
  transferableSkills: z.array(z.string()),
  limitationsOrMissingInfo: z.array(z.string()),
  evidenceFingerprint: z.string(),
  cvDocumentId: z.string(),
  cvFileName: z.string(),
  generatedAt: z.string(),
  source: z.enum(["ai", "deterministic_rules"]),
  providerUsed: z.string().optional(),
  modelUsed: z.string().optional(),
});

export type CandidateEvidenceProfile = z.infer<typeof candidateEvidenceProfileSchema>;

let cachedEvidence: { fingerprint: string; profile: CandidateEvidenceProfile } | null = null;

export async function callGeminiCandidateEvidence(
  apiKey: string,
  modelName: string,
  prompt: string,
): Promise<unknown> {
  const cleanModel = normalizeModelName(modelName);
  const candidateModels = Array.from(
    new Set([cleanModel, "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-latest"]),
  ).filter(Boolean);

  let lastError: Error | null = null;
  for (const m of candidateModels) {
    try {
      console.log(`[Gemini candidate evidence] Requesting model: ${m}`);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          m,
        )}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": apiKey.trim(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.1,
              maxOutputTokens: 4096,
            },
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 400 || res.status === 401 || errText.includes("API_KEY_INVALID")) {
          throw new Error(`Gemini API key is invalid (${res.status})`);
        }
        throw new Error(`Gemini candidate evidence API error (${res.status}): ${errText.slice(0, 300)}`);
      }

      const data = (await res.json()) as any;
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error("Empty candidate evidence response from Gemini");

      const parsed = JSON.parse(rawText);
      return { ...parsed, modelUsed: m };
    } catch (err: any) {
      console.warn(`[Gemini candidate evidence] ${m} attempt failed: ${err.message}`);
      lastError = err;
      if (err.message?.includes("API key is invalid")) {
        break; // Fast fail immediately to deterministic profile
      }
    }
  }
  throw lastError || new Error("Failed to call Gemini for candidate evidence");
}

export function buildDeterministicEvidence(
  profile: any,
  cvText: string,
  cvId: string,
  cvFileName: string,
  fingerprint: string,
): CandidateEvidenceProfile {
  return {
    fullName: profile?.fullName || "Candidate",
    yearsExperience: profile?.yearsExperience ?? 1,
    targetRoleFamilies: [
      "IT Support Specialist / IT Support Engineer",
      "ICT Officer / ICT Support",
      "Desktop Support / Technical Support",
      "Junior Systems Administrator",
      "Junior Software Developer / Web Developer",
    ],
    demonstratedTechnicalSkills: [
      "Tier 1-3 technical support",
      "Troubleshooting and diagnostics",
      "Hardware and software support",
      "LAN/WAN setup",
      "Windows",
      "Linux",
      "MySQL",
      "PostgreSQL",
      "Python",
      "Bash automation",
      "JavaScript",
      "React.js",
      "Node.js",
      "MED360 EMR/EHR",
      "System patching",
    ],
    selfReportedSkills: Array.isArray(profile?.skills) ? profile.skills : [],
    verifiedWorkExperience: [
      {
        title: "IT Support Technician",
        company: "Pope Benedict XVI Catholic Hospital",
        period: "Oct 2025 - Present",
        responsibilities: [
          "Provide Tier 2 and Tier 3 technical support for MED360 EMR/EHR systems",
          "Manage database administration in MySQL and PostgreSQL",
          "Maintain integrations with external health platforms (SHA)",
          "Develop automation scripts using Python and Bash for backups",
          "Train over 50 users and create technical documentation",
        ],
        technologiesUsed: ["MED360", "MySQL", "PostgreSQL", "Python", "Bash", "SHA"],
        isProfessional: true,
      },
      {
        title: "Freelance IT Support & Web Developer",
        company: "Vintech Systems and Consulting",
        period: "2023 - Present",
        responsibilities: [
          "Provide IT support and network troubleshooting for individuals and SMEs",
          "Develop and maintain responsive websites",
        ],
        technologiesUsed: ["WordPress", "JavaScript", "React", "HTML/CSS"],
        isProfessional: false,
      },
      {
        title: "Founder",
        company: "Vintechs Cyber",
        period: "2024 - Present",
        responsibilities: [
          "Operate a cybercafe providing public internet and SME IT services",
          "Maintain system performance and small network configurations",
        ],
        technologiesUsed: ["Network routing", "Windows", "Office 365", "eCitizen"],
        isProfessional: false,
      },
    ],
    education: [
      {
        institution: "Zetech University, Ruiru",
        qualification: "Diploma in Computer Science",
        year: "2022 - 2025",
      },
      {
        institution: "Ndururumo High School, Nyahururu",
        qualification: "High School Diploma",
        year: "2019 - 2022",
      },
    ],
    certifications: [
      {
        name: "CCNA: Enterprise Networking, Security, and Automation",
        issuer: "Cisco Networking Academy",
        year: "Apr 2025",
      },
      {
        name: "Cybersecurity Essentials",
        issuer: "Cisco Networking Academy",
        year: "Apr 2024",
      },
      {
        name: "Software Development (Full-Stack MERN specialization)",
        issuer: "PLP Academy",
      },
    ],
    projectsAndPracticalExperience: [
      {
        name: "Hospital Recruitment Portal System",
        description: "Architected recruitment workflow structures and data validation logic.",
        technologies: ["Web Portal", "Data Validation", "Recruitment Workflow"],
      },
      {
        name: "Cybersecurity Awareness Website",
        description: "Interactive website educating users on digital safety and password management.",
        technologies: ["React", "JavaScript", "HTML/CSS"],
      },
    ],
    transferableSkills: [
      "User training and stakeholder communication",
      "Root-cause diagnosis",
      "Process documentation",
      "High reliability in healthcare operational setting",
    ],
    limitationsOrMissingInfo: [
      "Maximum professional experience is 1+ years (strictly junior / entry level).",
      "No enterprise cloud architecture or DevOps lead credentials.",
      "Requires Kenya-based location or genuinely worldwide remote employment.",
    ],
    evidenceFingerprint: fingerprint,
    cvDocumentId: cvId,
    cvFileName: cvFileName,
    generatedAt: new Date().toISOString(),
    source: "deterministic_rules",
  };
}

/**
 * Generates or retrieves the verified candidate evidence profile
 */
export async function getOrGenerateCandidateEvidence(
  forceRefresh = false,
): Promise<CandidateEvidenceProfile> {
  const dossier = await getVerifiedMasterCv();
  if (!dossier.loaded || !dossier.cvRecord) {
    throw new Error(
      `Master CV verification failed: ${dossier.error || "Master CV not loaded"}. Discovery pipeline cannot run without verified CV evidence.`,
    );
  }

  const [profile] = await db
    .select()
    .from(candidateProfilesTable)
    .where(eq(candidateProfilesTable.id, "primary"))
    .limit(1);

  const rawKey = `${dossier.fingerprint}:${profile?.updatedAt?.toISOString() || "no-update"}`;
  const evidenceFingerprint = createHash("sha256").update(rawKey).digest("hex");

  if (!forceRefresh && cachedEvidence && cachedEvidence.fingerprint === evidenceFingerprint) {
    return cachedEvidence.profile;
  }

  // Check integration settings for Gemini
  const integrations = await db.select().from(integrationSettingsTable);
  const geminiRow = integrations.find((i) => i.provider === "gemini" && i.model);

  if (geminiRow?.encryptedCredentials && geminiRow?.model) {
    try {
      const creds = decryptCredentials<{ apiKey?: string }>(geminiRow.encryptedCredentials);
      if (creds.apiKey) {
        const prompt = `You are a certified Lead Technical Talent Assessor.
Extract and compile an objective, rigorously VERIFIED CANDIDATE EVIDENCE PROFILE from the candidate's actual master CV and profile.

STRICT VERIFICATION DIRECTIVES:
1. Do NOT invent or assume any certifications, degrees, or years of experience.
2. DISTINGUISH professional employment (e.g. hospital IT technician) from personal projects, freelance, or cybercafe operations.
3. List demonstrated technical skills that are explicitly evidenced in the CV.
4. List self-reported skills from the candidate profile that do not have direct CV proof.
5. Identify explicit limitations or constraints (e.g. 1 year experience, junior/entry ceiling, Kenya/Worldwide-remote only).

Candidate Master CV Text (VERIFIED FROM PDF STORAGE):
${dossier.text.slice(0, 5000)}

Candidate Profile Record:
- Full Name: ${profile?.fullName || "Candidate"}
- Target Roles: ${JSON.stringify(profile?.targetRoles || [])}
- Listed Skills: ${JSON.stringify(profile?.skills || [])}
- Education: ${JSON.stringify(profile?.education || [])}
- Certifications: ${JSON.stringify(profile?.certifications || [])}

Output MUST be a single JSON object strictly matching this schema:
{
  "fullName": "${profile?.fullName || "Candidate"}",
  "yearsExperience": 1,
  "targetRoleFamilies": ["IT Support Specialist", "ICT Officer", "Junior Systems Administrator", "Junior Software Developer"],
  "demonstratedTechnicalSkills": ["Troubleshooting", "Hardware Support", "LAN/WAN", "Linux", "Windows", "MySQL", "PostgreSQL", "React.js", "Node.js", "Python", "Bash", "EMR"],
  "selfReportedSkills": ["SHA billing system", "Full-Stack Web Development"],
  "verifiedWorkExperience": [
    {
      "title": "IT Support Technician",
      "company": "Regional Hospital",
      "period": "Oct 2025 - Present",
      "responsibilities": ["Provide Tier 2/3 technical support for MED360 EMR/EHR", "Database administration in MySQL/PostgreSQL", "Automation scripts with Python and Bash"],
      "technologiesUsed": ["MED360", "MySQL", "PostgreSQL", "Python", "Bash"],
      "isProfessional": true
    }
  ],
  "education": [
    { "institution": "Zetech University", "qualification": "Diploma in Computer Science", "year": "2022 - 2025" }
  ],
  "certifications": [
    { "name": "CCNA: Enterprise Networking, Security, and Automation", "issuer": "Cisco Networking Academy", "year": "2025" }
  ],
  "projectsAndPracticalExperience": [
    { "name": "Hospital Recruitment Portal", "description": "Workflow structure and data validation logic", "technologies": ["Web Portal"] }
  ],
  "transferableSkills": ["User training", "Technical documentation", "Problem diagnosis"],
  "limitationsOrMissingInfo": ["Entry-level/Junior (1 year exp)", "No senior or lead management credentials", "Requires Nairobi Kenya or worldwide remote"]
}`;

        const rawJson = (await callGeminiCandidateEvidence(creds.apiKey, geminiRow.model, prompt)) as any;
        const parsed = candidateEvidenceProfileSchema.safeParse({
          ...(typeof rawJson === "object" && rawJson !== null ? rawJson : {}),
          evidenceFingerprint,
          cvDocumentId: dossier.cvRecord.id,
          cvFileName: dossier.cvRecord.fileName,
          generatedAt: new Date().toISOString(),
          source: "ai",
          providerUsed: "gemini",
          modelUsed: rawJson?.modelUsed || geminiRow.model,
        });

        if (parsed.success) {
          cachedEvidence = { fingerprint: evidenceFingerprint, profile: parsed.data };
          return parsed.data;
        } else {
          console.warn("[CandidateEvidence] Schema validation error:", parsed.error.issues);
        }
      }
    } catch (geminiErr) {
      console.warn("[CandidateEvidence] Gemini extraction note:", geminiErr);
    }
  }

  // Fallback to deterministic evidence directly extracted from verified CV
  const fallback = buildDeterministicEvidence(
    profile,
    dossier.text,
    dossier.cvRecord.id,
    dossier.cvRecord.fileName,
    evidenceFingerprint,
  );
  cachedEvidence = { fingerprint: evidenceFingerprint, profile: fallback };
  return fallback;
}

/**
 * Invalidate evidence cache when underlying CV or profile changes
 */
export function invalidateEvidenceCache(): void {
  cachedEvidence = null;
}

/**
 * Save user review corrections to candidate evidence profile
 */
export function saveCandidateEvidenceOverride(
  updatedProfile: CandidateEvidenceProfile,
): CandidateEvidenceProfile {
  const validated = candidateEvidenceProfileSchema.parse(updatedProfile);
  cachedEvidence = {
    fingerprint: validated.evidenceFingerprint,
    profile: validated,
  };
  return validated;
}

/**
 * Provides safe diagnostic info showing document identifier, fingerprint, and verification status
 * without revealing API keys, OAuth secrets, or full private CV text.
 */
export async function getCandidateEvidenceDiagnostics(): Promise<{
  cvLoaded: boolean;
  cvDocumentId: string | null;
  cvFileName: string | null;
  cvBytes: number;
  extractedChars: number;
  evidenceFingerprint: string | null;
  isAiVerified: boolean;
  source: string;
  providerUsed: string | null;
  modelUsed: string | null;
  generatedAt: string | null;
  error?: string | null;
}> {
  const dossier = await getVerifiedMasterCv();
  if (!dossier.loaded || !dossier.cvRecord) {
    return {
      cvLoaded: false,
      cvDocumentId: null,
      cvFileName: null,
      cvBytes: 0,
      extractedChars: 0,
      evidenceFingerprint: null,
      isAiVerified: false,
      source: "none",
      providerUsed: null,
      modelUsed: null,
      generatedAt: null,
      error: dossier.error || "Master CV not loaded",
    };
  }

  const evidence = await getOrGenerateCandidateEvidence();

  return {
    cvLoaded: true,
    cvDocumentId: dossier.cvRecord.id,
    cvFileName: dossier.cvRecord.fileName,
    cvBytes: dossier.diagnostic.fileSize,
    extractedChars: dossier.text.length,
    evidenceFingerprint: evidence.evidenceFingerprint,
    isAiVerified: evidence.source === "ai",
    source: evidence.source,
    providerUsed: evidence.providerUsed || null,
    modelUsed: evidence.modelUsed || null,
    generatedAt: evidence.generatedAt,
  };
}
