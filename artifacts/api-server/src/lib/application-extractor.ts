/**
 * Application Extractor Module
 * Extracts actionable application instructions, contact emails, required attachments,
 * subject lines, and deadlines from job postings.
 */

export interface ApplicationDetails {
  applyEmail: string | null;
  allEmails: string[];
  subjectLine: string | null;
  whatToAttach: string[];
  deadline: string | null;
  deadlineDate: Date | null;
  methodOfApplication: string | null;
  applyPortalUrl: string | null;
  applicationFormat: "email" | "portal" | "google_form" | "in_person" | "unknown";
}

const IGNORED_EMAILS = new Set([
  "info@wordpress.org",
  "support@myjobmag.com",
  "support@myjobmag.co.ke",
  "info@jobwebkenya.com",
  "support@careerpointkenya.co.ke",
  "noreply@greenhouse.io",
  "no-reply@lever.co",
  "support@fuzu.com",
  "abuse@weworkremotely.com",
  "contact@remoteok.com",
]);

export function extractApplicationDetails(
  text: string,
  sourceUrl?: string | null,
  jobTitle?: string | null,
  companyName?: string | null
): ApplicationDetails {
  if (!text) {
    return {
      applyEmail: null,
      allEmails: [],
      subjectLine: jobTitle ? `Application for ${jobTitle}` : null,
      whatToAttach: ["Updated CV / Resume", "Cover Letter"],
      deadline: null,
      deadlineDate: null,
      methodOfApplication: null,
      applyPortalUrl: sourceUrl || null,
      applicationFormat: sourceUrl ? "portal" : "unknown",
    };
  }

  // 1. Find Method of Application / How to Apply Section
  const applySectionRegex = /(?:method of application|how to apply|mode of application|application procedure|to apply|instructions to apply|application process|submission of applications)[:\s*]+([\s\S]{1,1200})/i;
  const sectionMatch = text.match(applySectionRegex);
  const applicationSection = sectionMatch ? sectionMatch[1] : text;

  // 2. Extract & Score Emails (Prioritize recruitment/HR addresses)
  const rawEmails = applicationSection.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || 
                    text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  
  const validEmails = Array.from(
    new Set(
      rawEmails
        .map((e) => e.toLowerCase().trim())
        .filter((e) => !IGNORED_EMAILS.has(e) && !e.endsWith(".png") && !e.endsWith(".jpg") && !e.endsWith(".svg"))
    )
  ).sort((a, b) => {
    const isHrA = /recruitment|career|job|hr|vacanc|apply|talent|hiring/i.test(a);
    const isHrB = /recruitment|career|job|hr|vacanc|apply|talent|hiring/i.test(b);
    if (isHrA && !isHrB) return -1;
    if (!isHrA && isHrB) return 1;
    return 0;
  });

  const applyEmail = validEmails.length > 0 ? validEmails[0] : null;

  // 3. Extract Subject Line / Job Reference Code
  let subjectLine: string | null = null;
  const refMatch = text.match(/(?:job\s*ref(?:erence)?(?:\s*no\.?|\s*number|\s*code)?|ref\s*no\.?|reference\s*no\.?|vacancy\s*no\.?)[:\s*#]+([A-Za-z0-9\/_\.-]{3,30})/i);
  const subjectMatch = text.match(/(?:subject(?: line)?(?: of the email)?(?: should (?:be|read|state))?|(?:quote(?: the)? subject))[:\s*]+["'“]?([^"'\n\r\t.,;]{5,90})["'”]?/i);

  if (subjectMatch && subjectMatch[1]) {
    let extracted = subjectMatch[1]
      .replace(/^[:\s"'“]+|[:\s"'”]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (extracted.length >= 6 && !/^(as|the|an|a|to|for)$/i.test(extracted)) {
      subjectLine = extracted;
    }
  }

  if (!subjectLine) {
    if (refMatch && refMatch[1] && jobTitle) {
      const refCode = refMatch[1].replace(/^[#:\s]+/, "").trim();
      subjectLine = `Application for ${jobTitle} (Ref: ${refCode})`;
    } else if (jobTitle) {
      subjectLine = `Application for ${jobTitle}${companyName ? ` - ${companyName}` : ""}`;
    }
  }

  // 4. Detect Required Documents / What to Attach
  const attachments: string[] = [];
  const textLower = text.toLowerCase();

  // CV / Resume
  if (/cv|curriculum vitae|resume/i.test(textLower)) {
    attachments.push("Updated Curriculum Vitae (CV)");
  } else {
    attachments.push("Updated Curriculum Vitae (CV)"); // Default requirement
  }

  // Cover Letter / Application Letter
  if (/cover letter|application letter|motivational letter|letter of application/i.test(textLower)) {
    attachments.push("Cover Letter / Application Letter");
  }

  // Academic Certificates & Transcripts
  if (/academic (?:certificates|transcripts|records)|diploma certificate|degree certificate|kcse certificate|copies of certificates|certified copies/i.test(textLower)) {
    attachments.push("Academic Certificates & Transcripts (Diploma/Degree, KCSE)");
  }

  // National ID
  if (/national id|id card|copy of id|copy of national identity/i.test(textLower)) {
    attachments.push("Copy of National ID Card");
  }

  // Certifications & Licensures
  if (/professional certificate|ccna|itil|cisco|microsoft certificate|relevant certifications|practicing license|board certification|cpa|bar admission/i.test(textLower)) {
    attachments.push("Professional Certifications & Practicing Licenses");
  }

  // Testimonials / Letters of Recommendation
  if (/testimonials|recommendation letter|letters of recommendation|referee/i.test(textLower)) {
    attachments.push("Testimonials / Recommendation Letters");
  }

  // Portfolio / Work Samples
  if (/portfolio|github|code sample|gitlab|live project|writing sample|dossier/i.test(textLower)) {
    attachments.push("Work Portfolio / Sample Projects");
  }

  // 5. Extract Application Deadline
  let deadlineStr: string | null = null;
  let deadlineDate: Date | null = null;
  const deadlineMatch = text.match(
    /(?:deadline|closing date|apply by|application deadline|expires|closing on|submit before|valid until|on or before)[:\s*]+([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s+[0-9]{4}|[A-Za-z]+\s+[0-9]{1,2}(?:st|nd|rd|th)?,?\s+[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[\/\.-][0-9]{1,2}[\/\.-][0-9]{2,4})/i
  );

  if (deadlineMatch && deadlineMatch[1]) {
    deadlineStr = deadlineMatch[1].trim();
    const parsed = new Date(deadlineStr);
    if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2000) {
      deadlineDate = parsed;
    }
  } else if (/rolling basis|open until filled|ongoing recruitment/i.test(textLower)) {
    deadlineStr = "Rolling Basis / Open until filled";
  }

  // 6. Detect Google Form / External Portal Link
  let applyPortalUrl: string | null = null;
  const portalMatch = text.match(/https?:\/\/(?:forms\.gle|docs\.google\.com\/forms|forms\.office\.com|boards\.greenhouse\.io|jobs\.lever\.co|api\.ashbyhq\.com|[\w-]+\.recruitee\.com|[\w-]+\.workable\.com)[^\s"'>]+/i);
  if (portalMatch) {
    applyPortalUrl = portalMatch[0];
  } else if (sourceUrl) {
    applyPortalUrl = sourceUrl;
  }

  // 7. Determine Application Format
  let applicationFormat: ApplicationDetails["applicationFormat"] = "unknown";
  if (applyEmail) {
    applicationFormat = "email";
  } else if (applyPortalUrl && (applyPortalUrl.includes("forms.gle") || applyPortalUrl.includes("docs.google.com/forms"))) {
    applicationFormat = "google_form";
  } else if (applyPortalUrl && (applyPortalUrl.includes("greenhouse.io") || applyPortalUrl.includes("lever.co") || applyPortalUrl.includes("workable.com") || applyPortalUrl.includes("ashbyhq.com"))) {
    applicationFormat = "portal";
  } else if (sourceUrl) {
    applicationFormat = "portal";
  }

  // 8. Clean Method of Application text
  let methodOfApplication: string | null = null;
  if (sectionMatch && sectionMatch[1]) {
    methodOfApplication = sectionMatch[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 500);
  }

  return {
    applyEmail,
    allEmails: validEmails,
    subjectLine,
    whatToAttach: attachments,
    deadline: deadlineStr,
    deadlineDate,
    methodOfApplication,
    applyPortalUrl,
    applicationFormat,
  };
}

/**
 * Format a rich, structured application instructions banner to embed directly
 * in the job description so it is immediately visible in the UI.
 */
export function formatApplicationBanner(details: ApplicationDetails, jobTitle: string, company: string): string {
  const lines: string[] = [];

  lines.push("══════════════════════════════════════════════════════════════");
  lines.push("📋 APPLICATION DETAILS & HOW TO APPLY");
  lines.push("══════════════════════════════════════════════════════════════");

  if (details.applyEmail) {
    lines.push(`📧 Send Application To : ${details.applyEmail}`);
  }
  if (details.subjectLine) {
    lines.push(`📝 Required Subject Line : ${details.subjectLine}`);
  }
  if (details.deadline) {
    lines.push(`⏰ Application Deadline  : ${details.deadline}`);
  }
  if (details.applyPortalUrl && details.applyPortalUrl !== details.applyEmail) {
    lines.push(`🌐 Application Portal    : ${details.applyPortalUrl}`);
  }

  if (details.whatToAttach.length > 0) {
    lines.push("\n📎 WHAT TO ATTACH:");
    for (const doc of details.whatToAttach) {
      lines.push(`  • ${doc}`);
    }
  }

  if (details.methodOfApplication) {
    lines.push(`\n📌 Official Instructions:\n${details.methodOfApplication}`);
  }

  lines.push("══════════════════════════════════════════════════════════════\n");

  return lines.join("\n");
}
