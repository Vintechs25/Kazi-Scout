/**
 * Requirement Verification System
 * 
 * This module ensures that:
 * 1. Every job has clear application instructions before being presented
 * 2. Application methods (email, online, portal) are identified
 * 3. Required documents are extracted
 * 4. Eligibility requirements are checked
 * 5. Deadlines are tracked
 * 
 * Key principle: A job should NOT be presented as "suitable" unless:
 * - Application instructions are clear
 * - User meets basic eligibility
 * - Required documents can be provided
 */

import { z } from "@workspace/api-zod";
import { db, candidateProfilesTable, cvsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { NormalizedJob } from "./job-search-service";

// ============================================================================
// SCHEMAS
// ============================================================================

export const applicationMethodSchema = z.enum([
  "online",      // Apply via online form
  "email",       // Send CV via email
  "portal",      // Apply via company portal
  "walk_in",     // Walk-in application
  "phone",       // Call to apply
  "post",        // Postal mail
  "referral",    // Employee referral
  "social",      // Social media application
  "unknown",     // Cannot determine
]);

export const requirementVerificationSchema = z.object({
  // Instruction analysis
  hasClearInstructions: z.boolean(),
  applicationMethod: applicationMethodSchema,
  applicationUrl: z.string().nullable(),
  applicationEmail: z.string().nullable(),
  applicationPhone: z.string().nullable(),
  
  // Timing
  deadline: z.string().nullable(),
  deadlineDate: z.date().nullable(),
  isUrgent: z.boolean().default(false),
  daysUntilDeadline: z.number().nullable(),
  
  // Required documents
  requiredDocuments: z.array(z.string()).default([]),
  hasRequiredDocuments: z.boolean().default(false),
  missingDocuments: z.array(z.string()).default([]),
  
  // Eligibility
  eligibilityRequirements: z.array(z.string()).default([]),
  hardRequirements: z.array(z.string()).default([]), // Cannot be bypassed
  softRequirements: z.array(z.string()).default([]), // Nice to have
  
  // Special instructions
  specialInstructions: z.array(z.string()).default([]),
  doNotApplyConditions: z.array(z.string()).default([]),
  
  // Verification status
  isVerified: z.boolean(),
  verificationScore: z.number().min(0).max(100).default(0),
  verificationNotes: z.array(z.string()).default([]),
  verificationWarnings: z.array(z.string()).default([]),
  verificationErrors: z.array(z.string()).default([]),
  
  // Metadata
  verifiedAt: z.string(),
  verificationMethod: z.enum(["automatic", "manual", "ai"]).default("automatic"),
});

export type RequirementVerification = z.infer<typeof requirementVerificationSchema>;
export type ApplicationMethod = z.infer<typeof applicationMethodSchema>;

// ============================================================================
// EXTRACTION PATTERNS
// ============================================================================

// Patterns for extracting application methods
const APPLICATION_METHOD_PATTERNS: Array<{
  pattern: RegExp;
  method: ApplicationMethod;
  extract?: (match: RegExpMatchArray, text: string) => string | null;
}> = [
  // Online form
  {
    pattern: /apply\s+online|fill\s+(?:the\s+)?(?:application\s+)?form|apply\s+now|apply\s+here|click\s+(?:to\s+)?apply/i,
    method: "online",
  },
  {
    pattern: /application\s+form|online\s+application|web\s+form/i,
    method: "online",
  },
  // Email
  {
    pattern: /apply\s+via\s+email|send\s+(?:your\s+)?(?:cv\s+|resume\s+)?to|email\s+(?:your\s+)?(?:cv\s+|resume\s+|application\s+)to/i,
    method: "email",
    extract: (match, text) => {
      const emailMatch = text.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
      return emailMatch ? emailMatch[0] : null;
    },
  },
  {
    pattern: /email:\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i,
    method: "email",
    extract: (match) => match[1] || null,
  },
  // Portal
  {
    pattern: /career\s+portal|recruitment\s+portal|jobs?\s+portal|apply\s+(?:through\s+)?(?:our\s+)?portal/i,
    method: "portal",
  },
  {
    pattern: /(?:company|organization|our)\s+(?:career\s+)?portal\s+(?:at\s+)?(https?:\/\/[^\s]+)/i,
    method: "portal",
    extract: (match) => match[1] || null,
  },
  // Walk-in
  {
    pattern: /walk\s+\-?in|walk\s+in\s+application|apply\s+in\s+person|bring\s+(?:your\s+)?cv/i,
    method: "walk_in",
  },
  // Phone
  {
    pattern: /call\s+(?:to\s+)?apply|phone\s+application|apply\s+by\s+phone/i,
    method: "phone",
  },
  {
    pattern: /phone:\s*(\+?\d[\d\s-]{7,})/i,
    method: "phone",
    extract: (match) => match[1]?.replace(/\s/g, '') || null,
  },
  // Postal
  {
    pattern: /post\s+(?:your\s+)?(?:cv\s+|application\s+)to|mail\s+(?:your\s+)?(?:cv\s+|application\s+)to|p\.?o\.?\s*box/i,
    method: "post",
  },
  // Referral
  {
    pattern: /employee\s+referral|referral\s+program|referred\s+by\s+(?:an\s+)?employee/i,
    method: "referral",
  },
  // Social
  {
    pattern: /apply\s+on\s+(?:facebook|twitter|linkedin|whatsapp|telegram)|send\s+(?:a\s+)?message\s+on/i,
    method: "social",
  },
];

// Patterns for extracting deadlines
const DEADLINE_PATTERNS: Array<{
  pattern: RegExp;
  extract: (match: RegExpMatchArray) => Date | null;
}> = [
  {
    pattern: /deadline:\s*(\w+\s+\d{1,2},?\s*\d{4})/i,
    extract: (match) => new Date(match[1]),
  },
  {
    pattern: /closing\s+date:\s*(\w+\s+\d{1,2},?\s*\d{4})/i,
    extract: (match) => new Date(match[1]),
  },
  {
    pattern: /apply\s+by\s*(\w+\s+\d{1,2},?\s*\d{4})/i,
    extract: (match) => new Date(match[1]),
  },
  {
    pattern: /application\s+deadline:\s*(\w+\s+\d{1,2},?\s*\d{4})/i,
    extract: (match) => new Date(match[1]),
  },
  {
    pattern: /submission\s+deadline:\s*(\w+\s+\d{1,2},?\s*\d{4})/i,
    extract: (match) => new Date(match[1]),
  },
  {
    pattern: /last\s+date\s+to\s+apply:\s*(\w+\s+\d{1,2},?\s*\d{4})/i,
    extract: (match) => new Date(match[1]),
  },
  // Date only
  {
    pattern: /(\d{1,2}\/\d{1,2}\/\d{4})/,
    extract: (match) => {
      const [_, month, day, year] = match[0].split('/');
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    },
  },
  {
    pattern: /(\d{4}-\d{2}-\d{2})/,
    extract: (match) => new Date(match[1]),
  },
];

// Patterns for extracting required documents
const DOCUMENT_PATTERNS: Array<{
  pattern: RegExp;
  document: string;
}> = [
  { pattern: /cv|resume|curriculum\s+vitae/i, document: "CV/Resume" },
  { pattern: /cover\s+letter|covering\s+letter/i, document: "Cover Letter" },
  { pattern: /application\s+letter/i, document: "Application Letter" },
  { pattern: /certificate|certificates|academic\s+certificates/i, document: "Academic Certificates" },
  { pattern: /testimonial|testimonials/i, document: "Testimonials" },
  { pattern: /id|identity\s+card|national\s+id/i, document: "National ID" },
  { pattern: /passport/i, document: "Passport" },
  { pattern: /birth\s+certificate/i, document: "Birth Certificate" },
  { pattern: /kra\s+pin|tax\s+pin/i, document: "KRA PIN" },
  { pattern: /nhif\s+card/i, document: "NHIF Card" },
  { pattern: /nssf\s+card/i, document: "NSSF Card" },
  { pattern: /passport\s+photo|photograph/i, document: "Passport Photo" },
  { pattern: /transcript|academic\s+transcript/i, document: "Academic Transcript" },
  { pattern: /portfolio/i, document: "Portfolio" },
  { pattern: /driving\s+license|license/i, document: "Driving License" },
  { pattern: /good\s+conduct\s+certificate|certificate\s+of\s+good\s+conduct/i, document: "Certificate of Good Conduct" },
];

// Patterns for extracting eligibility requirements
const ELIGIBILITY_PATTERNS: Array<{
  pattern: RegExp;
  requirement: string;
  isHard?: boolean;
}> = [
  // Experience
  { pattern: /minimum\s+(\d+)\s*years?\s*experience/i, requirement: "Experience requirement", isHard: true },
  { pattern: /at\s+least\s+(\d+)\s*years?\s*experience/i, requirement: "Experience requirement", isHard: true },
  { pattern: /require\s+(\d+)\s*years?\s*experience/i, requirement: "Experience requirement", isHard: true },
  
  // Education
  { pattern: /bachelor\s*degree|bsc|degree\s*holder/i, requirement: "Bachelor's Degree required", isHard: true },
  { pattern: /master\s*degree|msc|mba/i, requirement: "Master's Degree required", isHard: true },
  { pattern: /diploma|higher\s+diploma/i, requirement: "Diploma required", isHard: true },
  { pattern: /certificate/i, requirement: "Certificate required" },
  
  // Citizenship
  { pattern: /kenyan\s+citizen|kenyan\s+national/i, requirement: "Kenyan citizenship required", isHard: true },
  { pattern: /must\s+be\s+kenyan/i, requirement: "Kenyan citizenship required", isHard: true },
  
  // Gender
  { pattern: /male\s+only|female\s+only|prefer\s+(?:male|female)/i, requirement: "Gender preference" },
  
  // Age
  { pattern: /age\s*\d+\s*(?:-\s*\d+)?\s*years?/i, requirement: "Age requirement" },
  { pattern: /between\s+\d+\s+and\s+\d+\s*years/i, requirement: "Age range" },
  
  // Other requirements
  { pattern: /must\s+have|should\s+have|required\s+to\s+have/i, requirement: "Specific requirement" },
];

// Patterns for extracting special instructions
const SPECIAL_INSTRUCTION_PATTERNS: Array<{
  pattern: RegExp;
  instruction: string;
}> = [
  { pattern: /do\s+not\s+apply|don't\s+apply/i, instruction: "Has exclusion criteria" },
  { pattern: /if\s+you\s+do\s+not\s+meet/i, instruction: "Has exclusion criteria" },
  { pattern: /not\s+eligible\s+if/i, instruction: "Has exclusion criteria" },
  { pattern: /no\s+phone\s+calls|strictly\s+no\s+calls/i, instruction: "No phone calls" },
  { pattern: /email\s+only|strictly\s+email/i, instruction: "Email only" },
  { pattern: /in\s+person\s+only|walk\s+in\s+only/i, instruction: "In-person only" },
  { pattern: /urgent|immediate\s+hiring/i, instruction: "Urgent hiring" },
  { pattern: /confidential|discreet/i, instruction: "Confidential application" },
  { pattern: /reference\s*\d+|provide\s+references/i, instruction: "References required" },
  { pattern: /background\s+check|police\s+clearance/i, instruction: "Background check required" },
  { pattern: /medical\s+examination/i, instruction: "Medical exam required" },
];

// Patterns for "do not apply" conditions
const DO_NOT_APPLY_PATTERNS: Array<{
  pattern: RegExp;
  condition: string;
}> = [
  { pattern: /if\s+you\s+do\s+not\s+have\s+(\d+)\s*years?\s*experience/i, condition: "Insufficient experience" },
  { pattern: /if\s+you\s+are\s+not\s+a\s+kenyan\s+citizen/i, condition: "Not Kenyan citizen" },
  { pattern: /if\s+you\s+do\s+not\s+have\s+a\s+degree/i, condition: "No degree" },
  { pattern: /if\s+you\s+are\s+not\s+qualified/i, condition: "Not qualified" },
];

// ============================================================================
// VERIFICATION FUNCTIONS
// ============================================================================

/**
 * Extract and verify application requirements from job text
 */
export function verifyApplicationRequirements(
  text: string,
  jobTitle?: string,
  company?: string,
  sourceUrl?: string | null,
): RequirementVerification {
  const lowerText = text.toLowerCase();
  
  // Extract application method
  let applicationMethod: ApplicationMethod = "unknown";
  let applicationUrl: string | null = null;
  let applicationEmail: string | null = null;
  let applicationPhone: string | null = null;
  
  for (const { pattern, method, extract } of APPLICATION_METHOD_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      applicationMethod = method;
      if (extract) {
        const extracted = extract(match, text);
        if (extracted) {
          if (method === "email") {
            applicationEmail = extracted;
          } else if (method === "portal") {
            applicationUrl = extracted;
          } else if (method === "phone") {
            applicationPhone = extracted;
          }
        }
      }
      break; // Use first match
    }
  }
  
  // Extract deadline
  let deadline: string | null = null;
  let deadlineDate: Date | null = null;
  let daysUntilDeadline: number | null = null;
  
  for (const { pattern, extract } of DEADLINE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      deadline = match[0].trim();
      const extractedDate = extract(match);
      if (extractedDate && !isNaN(extractedDate.getTime())) {
        deadlineDate = extractedDate;
        const now = new Date();
        const timeDiff = deadlineDate.getTime() - now.getTime();
        daysUntilDeadline = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
        break;
      }
    }
  }
  
  const isUrgent = daysUntilDeadline !== null && daysUntilDeadline <= 3;
  
  // Extract required documents
  const requiredDocuments: string[] = [];
  for (const { pattern, document } of DOCUMENT_PATTERNS) {
    if (pattern.test(lowerText) && !requiredDocuments.includes(document)) {
      requiredDocuments.push(document);
    }
  }
  
  // Extract eligibility requirements
  const eligibilityRequirements: string[] = [];
  const hardRequirements: string[] = [];
  const softRequirements: string[] = [];
  
  for (const { pattern, requirement, isHard } of ELIGIBILITY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      if (!eligibilityRequirements.includes(requirement)) {
        eligibilityRequirements.push(requirement);
        if (isHard) {
          hardRequirements.push(requirement);
        } else {
          softRequirements.push(requirement);
        }
      }
    }
  }
  
  // Extract special instructions
  const specialInstructions: string[] = [];
  for (const { pattern, instruction } of SPECIAL_INSTRUCTION_PATTERNS) {
    if (pattern.test(lowerText) && !specialInstructions.includes(instruction)) {
      specialInstructions.push(instruction);
    }
  }
  
  // Extract "do not apply" conditions
  const doNotApplyConditions: string[] = [];
  for (const { pattern, condition } of DO_NOT_APPLY_PATTERNS) {
    if (pattern.test(lowerText) && !doNotApplyConditions.includes(condition)) {
      doNotApplyConditions.push(condition);
    }
  }
  
  // If a valid web source or application URL is provided, candidate can apply via official portal
  if (sourceUrl && (sourceUrl.startsWith("http://") || sourceUrl.startsWith("https://"))) {
    if (applicationMethod === "unknown") {
      applicationMethod = "portal";
    }
    if (!applicationUrl) {
      applicationUrl = sourceUrl;
    }
  }

  // Determine if we have clear instructions
  const hasClearInstructions = applicationMethod !== "unknown" || 
    applicationUrl !== null || 
    applicationEmail !== null ||
    applicationPhone !== null ||
    requiredDocuments.length > 0;
  
  // Calculate verification score
  let verificationScore = 0;
  if (hasClearInstructions) verificationScore += 30;
  if (applicationMethod !== "unknown") verificationScore += 20;
  if (requiredDocuments.length > 0) verificationScore += 20;
  if (eligibilityRequirements.length > 0) verificationScore += 15;
  if (deadlineDate !== null) verificationScore += 10;
  if (applicationUrl !== null) verificationScore += 10;
  if (applicationEmail !== null) verificationScore += 5;
  
  verificationScore = Math.min(verificationScore, 100);
  
  // Is verified?
  const isVerified = (verificationScore >= 50 && hasClearInstructions) || (Boolean(applicationUrl) && applicationMethod === "portal");
  
  // Verification notes
  const verificationNotes: string[] = [];
  const verificationWarnings: string[] = [];
  const verificationErrors: string[] = [];
  
  if (!hasClearInstructions) {
    verificationErrors.push("No clear application instructions found");
    verificationScore = Math.min(verificationScore, 20);
  }
  
  if (applicationMethod === "unknown") {
    verificationWarnings.push("Application method could not be determined");
  }
  
  if (requiredDocuments.length === 0) {
    verificationWarnings.push("No required documents specified");
  }
  
  if (eligibilityRequirements.length === 0) {
    verificationWarnings.push("No eligibility requirements specified");
  }
  
  if (deadlineDate === null) {
    verificationWarnings.push("No deadline specified");
  }
  
  if (doNotApplyConditions.length > 0) {
    verificationWarnings.push(`Has exclusion criteria: ${doNotApplyConditions.join(", ")}`);
  }
  
  if (hardRequirements.length > 0) {
    verificationNotes.push(`Hard requirements: ${hardRequirements.join(", ")}`);
  }
  
  if (isUrgent) {
    verificationNotes.push("URGENT: Application deadline within 3 days");
  }
  
  return {
    hasClearInstructions,
    applicationMethod,
    applicationUrl,
    applicationEmail,
    applicationPhone,
    deadline,
    deadlineDate,
    isUrgent,
    daysUntilDeadline,
    requiredDocuments,
    hasRequiredDocuments: requiredDocuments.length > 0,
    missingDocuments: [],
    eligibilityRequirements,
    hardRequirements,
    softRequirements,
    specialInstructions,
    doNotApplyConditions,
    isVerified,
    verificationScore,
    verificationNotes,
    verificationWarnings,
    verificationErrors,
    verifiedAt: new Date().toISOString(),
    verificationMethod: "automatic",
  };
}

/**
 * Verify job requirements against user's profile
 */
export async function verifyJobAgainstUserProfile(
  job: NormalizedJob,
  accountId: string,
): Promise<{
  requirementVerification: RequirementVerification;
  canApply: boolean;
  canApplyReason: string;
  cannotApplyReason: string | null;
  confidence: number;
}> {
  // Get user's profile from database
  const [profile] = await db
    .select()
    .from(candidateProfilesTable)
    .where(eq(candidateProfilesTable.id, accountId))
    .limit(1);
  
  // Get user's CV data
  const [masterCv] = await db
    .select()
    .from(cvsTable)
    .where(and(
      eq(cvsTable.isMaster, true),
      // accountId filter would be here
    ))
    .limit(1);
  
  // Verify application requirements from job description and portal destination
  const requirementVerification = verifyApplicationRequirements(
    job.description || '',
    job.title,
    job.company,
    (job as any).applicationUrl || (job as any).sourceUrl || (job as any).url || null,
  );
  
  // Check if user can apply based on requirements
  let canApply = true;
  const cannotApplyReasons: string[] = [];
  const canApplyReasons: string[] = [];
  
  // Check hard requirements
  for (const req of requirementVerification.hardRequirements) {
    // Check if user meets this requirement
    if (/experience/i.test(req)) {
      // Check if user has enough experience
      const userExperience = profile?.yearsExperience || 0;
      const requiredMatch = req.match(/(\d+)/);
      if (requiredMatch) {
        const requiredYears = parseInt(requiredMatch[1]);
        if (userExperience < requiredYears) {
          canApply = false;
          cannotApplyReasons.push(`Requires ${requiredYears}+ years experience, user has ${userExperience}`);
        } else {
          canApplyReasons.push(`Meets experience requirement (${requiredYears}+ years)`);
        }
      }
    }
    
    if (/kenyan citizen/i.test(req)) {
      // Check if user is Kenyan (assuming yes for now)
      // In production, check profile.location or profile.nationality
      const userLocation = (profile?.country || "").toLowerCase();
      if (!userLocation.includes("kenya")) {
        canApply = false;
        cannotApplyReasons.push("Requires Kenyan citizenship");
      } else {
        canApplyReasons.push("Meets Kenyan citizenship requirement");
      }
    }
    
    if (/degree|bachelor|master/i.test(req)) {
      // Check if user has the required degree
      const userEducation = Array.isArray(profile?.education) ? profile.education.join(" ") : String(profile?.education || "");
      if (!/bachelor|master|degree/i.test(userEducation.toLowerCase())) {
        canApply = false;
        cannotApplyReasons.push(`Requires degree, user education: ${userEducation}`);
      } else {
        canApplyReasons.push("Meets degree requirement");
      }
    }
  }
  
  // Check "do not apply" conditions
  for (const condition of requirementVerification.doNotApplyConditions) {
    if (/insufficient experience|not enough experience/i.test(condition)) {
      const userExperience = profile?.yearsExperience || 0;
      if (userExperience < 1) {
        canApply = false;
        cannotApplyReasons.push("Insufficient experience");
      }
    }
    
    if (/not kenyan citizen/i.test(condition)) {
      const userLocation = (profile?.country || "").toLowerCase();
      if (!userLocation.includes("kenya")) {
        canApply = false;
        cannotApplyReasons.push("Not Kenyan citizen");
      }
    }
    
    if (/no degree/i.test(condition)) {
      const userEducation = Array.isArray(profile?.education) ? profile.education.join(" ") : String(profile?.education || "");
      if (!/bachelor|master|degree/i.test(userEducation.toLowerCase())) {
        canApply = false;
        cannotApplyReasons.push("No degree");
      }
    }
  }
  
  // Check if we have required documents
  if (requirementVerification.requiredDocuments.length > 0) {
    // In production, check if user has uploaded these documents
    // For now, assume user has CV
    const hasCv = masterCv !== undefined;
    if (requirementVerification.requiredDocuments.includes("CV/Resume") && !hasCv) {
      canApply = false;
      cannotApplyReasons.push("CV/Resume required but not uploaded");
    } else if (hasCv) {
      canApplyReasons.push("Has CV/Resume");
    }
  }
  
  // Check if we have clear instructions
  if (!requirementVerification.hasClearInstructions) {
    // This is a warning, not a blocker
    cannotApplyReasons.push("WARNING: No clear application instructions");
  } else {
    canApplyReasons.push("Has clear application instructions");
  }
  
  // Calculate confidence
  let confidence = requirementVerification.verificationScore;
  if (canApply) {
    confidence = Math.min(100, confidence + 20);
  } else {
    confidence = Math.max(0, confidence - 30);
  }
  
  return {
    requirementVerification,
    canApply,
    canApplyReason: canApplyReasons.join("; "),
    cannotApplyReason: cannotApplyReasons.length > 0 ? cannotApplyReasons.join("; ") : null,
    confidence,
  };
}

/**
 * Quick check: Can this job be presented to user?
 */
export function canPresentJobToUser(
  requirementVerification: RequirementVerification,
  requireClearInstructions: boolean = true,
  requireVerified: boolean = false,
): boolean {
  if (requireVerified && !requirementVerification.isVerified) {
    return false;
  }
  
  if (requireClearInstructions && !requirementVerification.hasClearInstructions) {
    return false;
  }
  
  // If we have "do not apply" conditions, be careful
  if (requirementVerification.doNotApplyConditions.length > 0) {
    // Still present it, but with warnings
    return true;
  }
  
  return true;
}

/**
 * Enhance job with requirement verification
 */
export function enhanceJobWithVerification(
  job: NormalizedJob,
): NormalizedJob & {
  requirementVerification: RequirementVerification;
  isRequirementVerified: boolean;
} {
  const requirementVerification = verifyApplicationRequirements(
    job.description || '',
    job.title,
    job.company,
  );
  
  return {
    ...job,
    requirementVerification,
    isRequirementVerified: requirementVerification.isVerified,
  };
}

// ============================================================================
// VERIFICATION SCORING
// ============================================================================

/**
 * Score a job based on how well it meets verification criteria
 */
export function scoreJobVerification(
  verification: RequirementVerification,
): {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  issues: string[];
} {
  const issues: string[] = [];
  let score = verification.verificationScore;
  
  if (!verification.hasClearInstructions) {
    score -= 30;
    issues.push("No clear instructions");
  }
  
  if (verification.applicationMethod === "unknown") {
    score -= 20;
    issues.push("Unknown application method");
  }
  
  if (verification.requiredDocuments.length === 0) {
    score -= 10;
    issues.push("No required documents specified");
  }
  
  if (verification.eligibilityRequirements.length === 0) {
    score -= 10;
    issues.push("No eligibility requirements");
  }
  
  if (verification.deadlineDate === null) {
    score -= 10;
    issues.push("No deadline");
  }
  
  if (verification.doNotApplyConditions.length > 0) {
    score -= 5;
    issues.push(`Has ${verification.doNotApplyConditions.length} exclusion criteria`);
  }
  
  score = Math.max(0, Math.min(100, score));
  
  let grade: "A" | "B" | "C" | "D" | "F" = "F";
  if (score >= 90) grade = "A";
  else if (score >= 75) grade = "B";
  else if (score >= 60) grade = "C";
  else if (score >= 40) grade = "D";
  
  return { score, grade, issues };
}

// ============================================================================
// EXPORT
// ============================================================================

export {
  APPLICATION_METHOD_PATTERNS,
  DEADLINE_PATTERNS,
  DOCUMENT_PATTERNS,
  ELIGIBILITY_PATTERNS,
  SPECIAL_INSTRUCTION_PATTERNS,
  DO_NOT_APPLY_PATTERNS,
};
