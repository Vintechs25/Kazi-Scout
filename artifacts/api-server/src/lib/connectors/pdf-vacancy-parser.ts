/**
 * County Public Service Board & Government PDF Vacancy Parser
 * 
 * Many Kenyan counties (e.g. Murang'a, Mandera, Kirinyaga, Kiambu, Machakos, Mombasa)
 * and public bodies (PSC, KMPDC) publish vacancy announcements exclusively as PDF documents.
 * 
 * This parser:
 * 1. Downloads the PDF announcement using secureFetch
 * 2. Extracts textual content across all pages via pdfjs-dist
 * 3. Identifies vacancy positions, reference numbers, job groups, and qualifications
 * 4. Extracts application method (Email, Postal/Hand Delivery, Portal) and deadline
 * 5. Yields normalized listings that do not require an online apply URL
 */

import { secureFetch } from "./http-client";
import type { NormalizedListing } from "./types";

export interface ParsedPdfNotice {
  sourceUrl: string;
  countyOrAgency: string;
  deadlineDate: Date | null;
  applicationMethod: "EMAIL" | "POSTAL" | "PORTAL" | "UNKNOWN";
  applicationEmail: string | null;
  postalAddress: string | null;
  positions: Array<{
    title: string;
    referenceNo?: string;
    jobGroup?: string;
    postCount?: number;
    description: string;
  }>;
}

export async function parsePdfVacancyNotice(
  pdfUrl: string,
  countyOrAgency: string,
  sourceId: string,
): Promise<NormalizedListing[]> {
  try {
    const res = await secureFetch(pdfUrl, { timeoutMs: 15_000 });
    if (!res.ok) {
      console.warn(`[PdfVacancyParser] Failed to download PDF at ${pdfUrl}: HTTP ${res.status}`);
      return [];
    }

    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const bytes = Buffer.from(res.text, "binary");
    const loadingTask = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
    });

    const doc = await loadingTask.promise;
    const pageCount = Math.min(doc.numPages, 15);
    let fullText = "";

    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageStr = content.items
        .map((it: any) => it.str || "")
        .join(" ");
      fullText += `\n${pageStr}`;
    }

    if (!fullText.trim()) return [];

    // 1. Extract Application Method
    const emailMatch = fullText.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/);
    const email = emailMatch ? emailMatch[1] : null;

    const postalMatch = fullText.match(/(?:p\.?o\.?\s*box\s*\d+[^,\n]+|hand\s+deliver(?:ed)?\s+to\s+[^,\n]+|sealed\s+envelope\s+addressed\s+to\s+[^,\n]+)/i);
    const postal = postalMatch ? postalMatch[0].trim() : null;

    let appMethod: "EMAIL" | "POSTAL" | "PORTAL" | "UNKNOWN" = "UNKNOWN";
    if (email) appMethod = "EMAIL";
    else if (postal) appMethod = "POSTAL";
    else if (/portal|online\s+application|apply\s+online/i.test(fullText)) appMethod = "PORTAL";

    // 2. Extract Deadline
    const deadlineMatch = fullText.match(
      /(?:deadline|closing\s+date|apply\s+by|submit\s+before|not\s+later\s+than)[:\s*]+([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s+[0-9]{4}|[A-Za-z]+\s+[0-9]{1,2}(?:st|nd|rd|th)?,?\s+[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i
    );
    let deadlineDate: Date | null = null;
    if (deadlineMatch && deadlineMatch[1]) {
      const parsed = new Date(deadlineMatch[1]);
      if (!isNaN(parsed.getTime())) deadlineDate = parsed;
    }

    // 3. Extract Positions (matches e.g. "1. Medical Officer - Job Group CPSB 07 (2 Posts)" or "V/NO. 1/2026: Pharmacist")
    const positionRegex = /(?:(?:\d+\.|\bV\/NO\.?\s*\d+\/\d+[:\s]+)\s*([A-Za-z\s,/&-]{5,60})(?:-\s*(?:Job\s+Group|JG|CPSB)\s*([A-Za-z0-9]+))?(?:\s*\(([0-9]+)\s*Posts?\))?)/gi;
    const matches = Array.from(fullText.matchAll(positionRegex));

    const listings: NormalizedListing[] = [];
    const seenTitles = new Set<string>();

    for (const m of matches) {
      const rawTitle = m[1].trim();
      const jobGroup = m[2] ? `Job Group ${m[2].trim()}` : null;
      const posts = m[3] ? `${m[3]} Posts` : null;

      if (rawTitle.length < 4 || /qualifications|requirements|how to apply|general conditions|duties and responsibilities/i.test(rawTitle)) {
        continue;
      }
      if (seenTitles.has(rawTitle.toLowerCase())) continue;
      seenTitles.add(rawTitle.toLowerCase());

      const title = rawTitle;
      const id = `${sourceId}-${Buffer.from(`${pdfUrl}-${title}`).toString("base64").slice(0, 20)}`;

      listings.push({
        id,
        sourceId,
        sourceName: countyOrAgency,
        externalJobId: pdfUrl,
        title,
        company: countyOrAgency,
        location: countyOrAgency.includes("County") ? countyOrAgency : "Kenya",
        county: countyOrAgency.replace(/\s*(?:County|CPSB|Government|Public Service Board)\s*/gi, "").trim(),
        country: "Kenya",
        remote: false,
        salary: jobGroup,
        description: `Official public recruitment announcement from ${countyOrAgency}: ${title} ${jobGroup ? `(${jobGroup})` : ""}. Vacancy advertised via official PDF notice. Application method: ${appMethod === "EMAIL" ? `Send CV to ${email}` : appMethod === "POSTAL" ? `Submit sealed hard-copy: ${postal}` : "Submit to County Board offices"}. ${deadlineDate ? `Deadline: ${deadlineDate.toDateString()}` : ""}`,
        url: pdfUrl,
        sourceUrl: pdfUrl,
        applicationUrl: pdfUrl,
        postedDate: new Date(),
        jobType: "Full-time",
        skills: [],
      });
    }

    return listings;
  } catch (err: any) {
    console.warn(`[PdfVacancyParser] Error extracting PDF notice at ${pdfUrl}:`, err.message);
    return [];
  }
}
