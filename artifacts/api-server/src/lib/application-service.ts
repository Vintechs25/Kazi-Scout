/**
 * Application Service
 * Handles automated job applications via Gmail
 * Supports CV and document attachments
 */

import { eq, and, or, gt, desc } from "drizzle-orm";
import { db, jobsTable, applicationsTable, cvsTable, candidateProfilesTable, integrationSettingsTable } from "@workspace/db";
import { decryptCredentials } from "./credential-encryption";
import type { JobRecord, Application } from "@workspace/db";

// Application template configurations
export interface ApplicationTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  includeCV: boolean;
  includeCoverLetter: boolean;
  customFields: Record<string, string>;
}

// Default application templates
const DEFAULT_TEMPLATES: ApplicationTemplate[] = [
  {
    id: "standard",
    name: "Standard Application",
    subject: "Application for {{jobTitle}} position",
    body: `Dear Hiring Manager,

I am writing to express my interest in the {{jobTitle}} position at {{company}}.

With my background in {{skills}}, I believe I am a strong candidate for this role. I have {{experience}} years of experience in {{industry}}.

Please find my CV attached for your consideration.

Best regards,
{{fullName}}`,
    includeCV: true,
    includeCoverLetter: false,
    customFields: {},
  },
  {
    id: "with-cover-letter",
    name: "With Cover Letter",
    subject: "Application for {{jobTitle}} - {{fullName}}",
    body: `Dear {{hiringManager}},

I am excited to apply for the {{jobTitle}} position at {{company}}, as advertised on {{source}}.

With my background in {{skills}}, I am confident in my ability to contribute to your team. My experience includes:
- {{achievement1}}
- {{achievement2}}
- {{achievement3}}

Please find my CV and cover letter attached.

I look forward to the opportunity to discuss my application further.

Best regards,
{{fullName}}`,
    includeCV: true,
    includeCoverLetter: true,
    customFields: {},
  },
  {
    id: "kenya-focused",
    name: "Kenya-Focused Application",
    subject: "Application: {{jobTitle}} - Kenyan Professional",
    body: `Dear Sir/Madam,

I am a Kenyan professional with {{experience}} years of experience in {{skills}}. I am writing to apply for the {{jobTitle}} position at {{company}}.

I am particularly interested in this opportunity as it offers remote work, which allows me to contribute effectively from Kenya.

Key qualifications:
- {{qualification1}}
- {{qualification2}}
- {{qualification3}}

Please find my CV attached. I am available for interviews and can provide references upon request.

Thank you for your consideration.

Best regards,
{{fullName}}
{{phone}}
{{email}}`,
    includeCV: true,
    includeCoverLetter: false,
    customFields: {},
  },
];

// Gmail API wrapper
export interface GmailMessage {
  to: string;
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  attachments?: Array<{ filename: string; content: Buffer | string; contentType: string }>;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface GmailCredentials {
  accessToken: string;
  refreshToken: string;
  expiry: number;
  clientId: string;
  clientSecret: string;
}

/**
 * Get Gmail credentials from database
 */
async function getGmailCredentials(): Promise<GmailCredentials | null> {
  const [settings] = await db
    .select()
    .from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.provider, "gmail"))
    .limit(1);

  if (!settings || !settings.connectedEmail) {
    return null;
  }

  try {
    const credentials = decryptCredentials<{
      accessToken?: string;
      refreshToken?: string;
      expiry?: number;
      clientSecret?: string;
    }>(settings.encryptedCredentials);

    if (!credentials.accessToken || !credentials.refreshToken) {
      return null;
    }

    return {
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      expiry: credentials.expiry || 0,
      clientId: settings.clientId || "",
      clientSecret: credentials.clientSecret || "",
    };
  } catch (error) {
    console.error("Error decrypting Gmail credentials:", error);
    return null;
  }
}

/**
 * Send email via Gmail API
 * Placeholder - would integrate with actual Gmail API
 */
export async function sendEmailViaGmail(message: GmailMessage): Promise<SendEmailResult> {
  const credentials = await getGmailCredentials();

  if (!credentials) {
    return {
      success: false,
      error: "Gmail not configured. Please connect your Gmail account in settings.",
    };
  }

  // Check if access token is expired
  if (credentials.expiry < Date.now()) {
    // Would refresh token here in a real implementation
    return {
      success: false,
      error: "Gmail access token expired. Please reconnect.",
    };
  }

  try {
    // In a real implementation, this would call the Gmail API
    // For now, we'll simulate the API call
    console.log("Sending email via Gmail:");
    console.log(`  To: ${message.to}`);
    console.log(`  Subject: ${message.subject}`);
    console.log(`  Attachments: ${message.attachments?.length || 0}`);

    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Generate a mock message ID
    const messageId = `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return {
      success: true,
      messageId,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to send email: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Get candidate profile for application
 */
async function getCandidateProfile() {
  const [profile] = await db
    .select()
    .from(candidateProfilesTable)
    .where(eq(candidateProfilesTable.id, "primary"))
    .limit(1);

  if (!profile) {
    throw new Error("No candidate profile found. Please create your profile first.");
  }

  return profile;
}

/**
 * Get CV for attachment
 */
async function getCVAttachment(cvId: string) {
  const [cv] = await db
    .select()
    .from(cvsTable)
    .where(eq(cvsTable.id, cvId))
    .limit(1);

  if (!cv) {
    throw new Error(`CV with ID ${cvId} not found.`);
  }

  // In a real implementation, we would read the CV file from storage
  // For now, return mock attachment info
  return {
    filename: cv.fileName,
    content: `Mock CV content for ${cv.fileName}`,
    contentType: cv.fileType === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

/**
 * Generate cover letter
 */
function generateCoverLetter(job: JobRecord, profile: any, template?: ApplicationTemplate): string {
  if (!template) {
    template = DEFAULT_TEMPLATES[0];
  }

  // Replace placeholders in the template
  let body = template.body
    .replace(/\{\{jobTitle\}\}/g, job.title)
    .replace(/\{\{company\}\}/g, job.company)
    .replace(/\{\{source\}\}/g, job.source)
    .replace(/\{\{fullName\}\}/g, profile.fullName || "")
    .replace(/\{\{email\}\}/g, profile.email || "")
    .replace(/\{\{phone\}\}/g, profile.phone || "");

  // Handle skills
  if (profile.skills && profile.skills.length > 0) {
    body = body.replace(/\{\{skills\}\}/g, profile.skills.join(", "));
  }

  // Handle experience
  if (profile.yearsExperience) {
    body = body.replace(/\{\{experience\}\}/g, `${profile.yearsExperience}+ years`);
  }

  // Handle industry
  if (profile.industries && profile.industries.length > 0) {
    body = body.replace(/\{\{industry\}\}/g, profile.industries[0]);
  }

  return body;
}

/**
 * Prepare application email
 */
export async function prepareApplicationEmail(
  job: JobRecord,
  templateId: string = "standard",
  cvId?: string,
): Promise<GmailMessage | null> {
  try {
    // Get candidate profile
    const profile = await getCandidateProfile();

    // Get template
    const template = DEFAULT_TEMPLATES.find(t => t.id === templateId) || DEFAULT_TEMPLATES[0];

    // Find email address to apply to (mock for now)
    const toEmail = extractEmailFromJob(job) || "applications@company.com";

    // Generate subject
    const subject = template.subject
      .replace(/\{\{jobTitle\}\}/g, job.title)
      .replace(/\{\{company\}\}/g, job.company)
      .replace(/\{\{fullName\}\}/g, profile.fullName || "");

    // Generate body
    const body = generateCoverLetter(job, profile, template);

    // Prepare attachments
    const attachments: GmailMessage["attachments"] = [];

    // Add CV if requested
    if (template.includeCV) {
      if (cvId) {
        const cvAttachment = await getCVAttachment(cvId);
        attachments.push({
          filename: cvAttachment.filename,
          content: cvAttachment.content,
          contentType: cvAttachment.contentType,
        });
      } else {
        // Get default/master CV
        const [masterCV] = await db
          .select()
          .from(cvsTable)
          .where(eq(cvsTable.isMaster, true))
          .limit(1);

        if (masterCV) {
          const cvAttachment = await getCVAttachment(masterCV.id);
          attachments.push({
            filename: cvAttachment.filename,
            content: cvAttachment.content,
            contentType: cvAttachment.contentType,
          });
        }
      }
    }

    return {
      to: toEmail,
      subject,
      body,
      attachments,
    };
  } catch (error) {
    console.error("Error preparing application email:", error);
    return null;
  }
}

/**
 * Apply to a job automatically
 */
export async function autoApplyToJob(
  jobId: string,
  templateId: string = "standard",
  cvId?: string,
): Promise<{
  success: boolean;
  applicationId?: string;
  messageId?: string;
  error?: string;
}> {
  // Get the job
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);

  if (!job) {
    return {
      success: false,
      error: `Job with ID ${jobId} not found.`,
    };
  }

  // Check if already applied
  const [existingApplication] = await db
    .select()
    .from(applicationsTable)
    .where(eq(applicationsTable.jobId, jobId))
    .limit(1);

  if (existingApplication) {
    return {
      success: false,
      error: `Already applied to job ${job.title} at ${job.company}.`,
    };
  }

  // Prepare email
  const email = await prepareApplicationEmail(job, templateId, cvId);
  if (!email) {
    return {
      success: false,
      error: "Failed to prepare application email.",
    };
  }

  // Send email via Gmail
  const sendResult = await sendEmailViaGmail(email);
  if (!sendResult.success) {
    return {
      success: false,
      error: sendResult.error || "Failed to send email.",
    };
  }

  // Save application record
  const now = new Date();
  const applicationId = crypto.randomUUID();

  try {
    await db.insert(applicationsTable).values({
      id: applicationId,
      jobId: job.id,
      method: "email" as const,
      status: "SUBMITTED" as const,
      matchScore: job.matchScore,
      appliedAt: now,
      lastActivityAt: now,
    });

    // Update job status
    await db
      .update(jobsTable)
      .set({ status: "APPLIED" as any })
      .where(eq(jobsTable.id, job.id));

    return {
      success: true,
      applicationId,
      messageId: sendResult.messageId,
    };
  } catch (error) {
    console.error("Error saving application record:", error);
    return {
      success: false,
      error: `Application sent but failed to save record: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Auto-apply to multiple high-match jobs
 */
export async function autoApplyToHighMatchJobs(
  minScore: number = 80,
  maxApplications: number = 10,
  templateId: string = "kenya-focused",
): Promise<{
  applied: number;
  skipped: number;
  errors: number;
  results: Array<{
    jobId: string;
    jobTitle: string;
    company: string;
    success: boolean;
    error?: string;
    applicationId?: string;
  }>;
}> {
  const results: Array<{
    jobId: string;
    jobTitle: string;
    company: string;
    success: boolean;
    error?: string;
    applicationId?: string;
  }> = [];

  let applied = 0;
  let skipped = 0;
  let errors = 0;

  // Get high-match jobs that haven't been applied to yet
  const allJobs = await db
    .select()
    .from(jobsTable)
    .where(
      and(
        gt(jobsTable.matchScore, minScore),
        eq(jobsTable.status, "MATCHED" as const), // Only matched jobs
      ),
    )
    .orderBy(desc(jobsTable.matchScore))
    .limit(maxApplications);

  // Filter out jobs that already have applications
  const jobs = await Promise.all(
    allJobs.map(async (job) => {
      const [existingApp] = await db
        .select({ id: applicationsTable.id })
        .from(applicationsTable)
        .where(eq(applicationsTable.jobId, job.id))
        .limit(1);
      return existingApp ? null : job;
    })
  ).then(jobs => jobs.filter(Boolean) as JobRecord[]);

  // Get master CV
  const [masterCV] = await db
    .select()
    .from(cvsTable)
    .where(eq(cvsTable.isMaster, true as const))
    .limit(1);

  for (const job of jobs) {
    try {
      // Apply to job
      const result = await autoApplyToJob(job.id, templateId, masterCV?.id);

      if (result.success) {
        applied++;
        results.push({
          jobId: job.id,
          jobTitle: job.title,
          company: job.company,
          success: true,
          applicationId: result.applicationId,
        });
      } else {
        errors++;
        results.push({
          jobId: job.id,
          jobTitle: job.title,
          company: job.company,
          success: false,
          error: result.error,
        });
      }

      // Rate limit: wait 2 seconds between applications
      if (applied % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Stop if we've applied to enough jobs
      if (applied >= maxApplications) {
        break;
      }
    } catch (error) {
      errors++;
      results.push({
        jobId: job.id,
        jobTitle: job.title,
        company: job.company,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { applied, skipped, errors, results };
}

/**
 * Check for job application responses
 * This would monitor Gmail for replies to applications
 */
export async function checkForApplicationResponses(): Promise<{
  newResponses: number;
  interviews: number;
  rejections: number;
  errors: number;
}> {
  // TODO: Implement Gmail monitoring for application responses
  // This would:
  // 1. Search Gmail for emails related to job applications
  // 2. Parse responses to identify interviews, rejections, offers
  // 3. Update application status accordingly
  
  // For now, return mock data
  return {
    newResponses: 0,
    interviews: 0,
    rejections: 0,
    errors: 0,
  };
}

/**
 * Helper to extract email from job posting
 */
function extractEmailFromJob(job: JobRecord): string | null {
  // Try to extract email from description
  const emailMatch = job.description.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+/);
  if (emailMatch) {
    return emailMatch[0];
  }

  // Try to extract from company name (common patterns)
  const companyLower = job.company.toLowerCase();
  const commonDomains: Record<string, string> = {
    "techcorp": "applications@techcorp.com",
    "innovatetech": "careers@innovatetech.com",
    "websolutions": "jobs@websolutions.com",
  };

  for (const [key, email] of Object.entries(commonDomains)) {
    if (companyLower.includes(key)) {
      return email;
    }
  }

  return null;
}

/**
 * Get application statistics
 */
export async function getApplicationStats() {
  const allApps = await db.select().from(applicationsTable);
  
  const stats = {
    total: allApps.length,
    submitted: allApps.filter((app: Application) => app.status === "SUBMITTED").length,
    interviews: allApps.filter((app: Application) => app.status === "INTERVIEW").length,
    offers: allApps.filter((app: Application) => app.status === "OFFER").length,
    rejected: allApps.filter((app: Application) => app.status === "REJECTED" || app.status === "WITHDRAWN").length,
  };

  return stats;
}
