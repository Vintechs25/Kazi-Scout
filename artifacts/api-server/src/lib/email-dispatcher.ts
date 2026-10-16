/**
 * Email Dispatcher Service
 * Handles sending job applications via connected Gmail OAuth API or SMTP.
 */

import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, integrationSettingsTable, cvsTable, applicationsTable, jobsTable, activityTable } from "@workspace/db";
import { decryptCredentials } from "./credential-encryption";
import { buildRawMimeMessage, type AttachmentFile } from "./mime-builder";

export interface SendApplicationResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Get a fresh access token using the stored Gmail OAuth refresh token
 */
async function getFreshGmailAccessToken(): Promise<{ accessToken: string; userEmail: string } | null> {
  const [settings] = await db
    .select()
    .from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.provider, "gmail"))
    .limit(1);

  if (!settings || !settings.encryptedCredentials || !settings.clientId) {
    return null;
  }

  let creds: { clientSecret?: string; refreshToken?: string; appPassword?: string };
  try {
    creds = decryptCredentials<{ clientSecret?: string; refreshToken?: string; appPassword?: string }>(
      settings.encryptedCredentials,
    );
  } catch (e) {
    console.error("[EmailDispatcher] Failed to decrypt Gmail credentials:", e);
    return null;
  }

  if (!creds || !creds.refreshToken || !creds.clientSecret) {
    console.error("[EmailDispatcher] Missing refreshToken or clientSecret in decrypted credentials");
    return null;
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: settings.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error("[EmailDispatcher] Failed to refresh Gmail access token:", errText);
    return null;
  }

  const data = (await tokenRes.json()) as { access_token: string };
  return {
    accessToken: data.access_token,
    userEmail: settings.connectedEmail || "me",
  };
}

/**
 * Send an approved application email via Gmail API
 */
export async function sendApplicationEmail(
  application: any,
  candidateProfile: any,
  storageDir: string
): Promise<SendApplicationResult> {
  if (!application.recipientEmail) {
    return { success: false, error: "No recipient email address specified." };
  }

  const gmailAuth = await getFreshGmailAccessToken();
  if (!gmailAuth) {
    return {
      success: false,
      error: "Google/Gmail is not connected. Please connect your Google account in Settings -> Connections.",
    };
  }

  // Load attached documents
  const attachments: AttachmentFile[] = [];
  let attachedDocIds: string[] = [];

  if (Array.isArray(application.attachedDocumentIds)) {
    attachedDocIds = application.attachedDocumentIds;
  } else if (typeof application.attachedDocumentIds === "string") {
    try {
      const parsed = JSON.parse(application.attachedDocumentIds);
      attachedDocIds = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      attachedDocIds = [];
    }
  }

  if (attachedDocIds.length > 0) {
    for (const docId of attachedDocIds) {
      const [doc] = await db.select().from(cvsTable).where(eq(cvsTable.id, docId)).limit(1);
      if (doc) {
        let filePath = path.resolve(storageDir, doc.storageName);
        if (!fs.existsSync(filePath)) {
          const fallbackCandidates = [
            path.resolve(process.cwd(), "storage/cvs", doc.storageName),
            path.resolve(process.cwd(), "../storage/cvs", doc.storageName),
            path.resolve(process.cwd(), "../../storage/cvs", doc.storageName),
          ];
          for (const cand of fallbackCandidates) {
            if (fs.existsSync(cand)) {
              filePath = cand;
              break;
            }
          }
        }

        if (fs.existsSync(filePath)) {
          const fileData = fs.readFileSync(filePath);
          attachments.push({
            filename: doc.fileName,
            contentType: doc.fileType === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            data: fileData,
          });
          console.log(`[EmailDispatcher] Attached from disk: "${doc.fileName}" (${doc.storageName}), ${fileData.length} bytes`);
        } else if (doc.fileData) {
          try {
            const fileData = Buffer.from(doc.fileData, "base64");
            attachments.push({
              filename: doc.fileName,
              contentType: doc.fileType === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              data: fileData,
            });
            console.log(`[EmailDispatcher] Attached from cloud DB: "${doc.fileName}", ${fileData.length} bytes`);
          } catch (err: any) {
            console.error(`[EmailDispatcher] Failed to decode base64 fileData for "${doc.fileName}":`, err?.message);
          }
        } else {
          console.warn(`[EmailDispatcher] File not found on disk or cloud DB: "${doc.fileName}" at ${filePath}`);
        }
      }
    }
  }

  // Strict sanitization: ensure ZERO branding, AI markers, or agent attributions ever leak into candidate emails
  const cleanSubject = String(application.subjectLine || "Job Application")
    .replace(/(?:sent (?:via|from|by)|powered by) (?:kaziscout|vintech(?: systems)?)[^\r\n]*/gi, "")
    .replace(/\[?(?:kaziscout|ai[- ]job[- ]agent)\]?/gi, "")
    .trim();

  const cleanBody = String(application.coverLetter || "Please find attached my job application and credentials.")
    .replace(/(?:sent (?:via|from|by)|powered by) (?:kaziscout|vintech(?: systems)?)[^\r\n]*/gi, "")
    .replace(/(?:kaziscout|ai[- ]job[- ]agent) (?:automated )?(?:application|submission)[^\r\n]*/gi, "")
    .trim();

  const rawMime = buildRawMimeMessage({
    fromName: candidateProfile?.fullName || "Candidate",
    fromEmail: gmailAuth.userEmail,
    to: application.recipientEmail,
    subject: cleanSubject,
    bodyText: cleanBody,
    attachments,
  });

  try {
    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gmailAuth.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: rawMime }),
    });

    if (!sendRes.ok) {
      const err = await sendRes.text();
      console.error("[EmailDispatcher] Gmail API send error:", err);
      return { success: false, error: `Gmail API Error: ${err}` };
    }

    const resData = (await sendRes.json()) as { id: string };

    // Update application record
    await db
      .update(applicationsTable)
      .set({
        status: "SUBMITTED",
        appliedAt: new Date(),
        lastActivityAt: new Date(),
      })
      .where(eq(applicationsTable.id, application.id));

    // Update corresponding job record to APPLIED
    if (application.jobId) {
      await db
        .update(jobsTable)
        .set({
          status: "APPLIED" as any,
        })
        .where(eq(jobsTable.id, application.jobId));
    }

    // Log Activity
    await db.insert(activityTable).values({
      id: crypto.randomUUID(),
      kind: "application",
      message: `Sent application for ${application.subjectLine} to ${application.recipientEmail} with ${attachments.length} attachment(s).`,
      createdAt: new Date(),
    });

    return { success: true, messageId: resData.id };
  } catch (err: any) {
    console.error("[EmailDispatcher] Send failed exception:", err);
    return { success: false, error: err.message || "Unknown sending error" };
  }
}
