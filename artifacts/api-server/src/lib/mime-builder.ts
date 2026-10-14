/**
 * MIME Message Builder for Gmail API & Email Dispatch
 * Builds standard RFC 2822 base64url encoded MIME messages with multipart/mixed attachments.
 */

import fs from "node:fs";

export interface AttachmentFile {
  filename: string;
  contentType: string;
  data: Buffer | string;
}

export interface EmailMessagePayload {
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: AttachmentFile[];
}

export function buildRawMimeMessage(payload: EmailMessagePayload): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  const lines: string[] = [];

  // Headers
  lines.push(`From: =?UTF-8?B?${Buffer.from(payload.fromName).toString("base64")}?= <${payload.fromEmail}>`);
  lines.push(`To: <${payload.to}>`);
  lines.push(`Subject: =?UTF-8?B?${Buffer.from(payload.subject).toString("base64")}?=`);
  lines.push(`MIME-Version: 1.0`);
  lines.push(`Date: ${new Date().toUTCString()}`);
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push("");

  // Body text part
  lines.push(`--${boundary}`);
  lines.push(`Content-Type: text/plain; charset="UTF-8"`);
  lines.push(`Content-Transfer-Encoding: base64`);
  lines.push("");
  lines.push(Buffer.from(payload.bodyText).toString("base64"));
  lines.push("");

  // Attachments
  if (payload.attachments && payload.attachments.length > 0) {
    for (const att of payload.attachments) {
      const buffer = Buffer.isBuffer(att.data) ? att.data : Buffer.from(att.data);
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: ${att.contentType || "application/octet-stream"}; name="=?UTF-8?B?${Buffer.from(att.filename).toString("base64")}?="`);
      lines.push(`Content-Disposition: attachment; filename="=?UTF-8?B?${Buffer.from(att.filename).toString("base64")}?="`);
      lines.push(`Content-Transfer-Encoding: base64`);
      lines.push("");
      lines.push(buffer.toString("base64"));
      lines.push("");
    }
  }

  lines.push(`--${boundary}--`);

  const fullMime = lines.join("\r\n");
  return Buffer.from(fullMime)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
