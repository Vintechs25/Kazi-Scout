import mammoth from "mammoth";
import zlib from "node:zlib";

const maxPages = 60;
export const maxCvTextCharacters = 60_000;

function extractPdfRawTextFallback(bytes: Buffer): string {
  const textChunks: string[] = [];
  const rawStr = bytes.toString("latin1");
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(rawStr)) !== null) {
    const streamData = Buffer.from(match[1], "latin1");
    let decompressed: string;
    try {
      decompressed = zlib.inflateSync(streamData).toString("utf-8");
    } catch {
      try {
        decompressed = zlib.inflateRawSync(streamData).toString("utf-8");
      } catch {
        decompressed = match[1];
      }
    }

    const tjRegex = /\(([^)]+)\)\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = tjRegex.exec(decompressed)) !== null) {
      textChunks.push(m[1]);
    }

    const arrRegex = /\[(.*?)\]\s*TJ/g;
    while ((m = arrRegex.exec(decompressed)) !== null) {
      const innerTj = /\(([^)]+)\)/g;
      let im: RegExpExecArray | null;
      while ((im = innerTj.exec(m[1])) !== null) {
        textChunks.push(im[1]);
      }
    }
  }

  // If streams had text, return unescaped text
  if (textChunks.length > 0) {
    return textChunks
      .join(" ")
      .replace(/\\([()\\])/g, "$1")
      .replace(/\\[nrtbf]/g, " ")
      .trim();
  }

  // Final fallback: scan for readable ASCII text words (> 3 chars) in the raw buffer
  const words = rawStr.match(/[A-Za-z0-9@._+-]{4,}/g) || [];
  const meaningful = words.filter(
    (w) => !/^[0-9a-f]{16,}$/i.test(w) && !/obj|endobj|stream|endstream|xref|trailer|startxref/i.test(w),
  );
  return meaningful.slice(0, 500).join(" ");
}

export async function extractCvText(
  bytes: Buffer,
  fileType: "pdf" | "docx",
): Promise<{ text: string; truncated: boolean }> {
  let extracted = "";

  if (fileType === "docx") {
    try {
      const result = await mammoth.extractRawText({ buffer: bytes });
      extracted = result.value || "";
    } catch (docxErr: any) {
      console.warn("[CvTextExtraction] DOCX extraction error:", docxErr?.message);
    }
  } else {
    // 1. Primary: pdfjs-dist
    try {
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loadingTask = getDocument({
        data: new Uint8Array(bytes),
        useSystemFonts: true,
      });
      try {
        const document = await loadingTask.promise;
        const pageCount = Math.min(document.numPages, maxPages);
        const pages: string[] = [];
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
          const page = await document.getPage(pageNumber);
          const content = await page.getTextContent();
          pages.push(
            content.items
              .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
              .filter(Boolean)
              .join(" "),
          );
        }
        extracted = pages.join("\n");
      } finally {
        await loadingTask.destroy().catch(() => {});
      }
    } catch (pdfErr: any) {
      console.warn("[CvTextExtraction] pdfjs-dist parser encountered an issue, trying stream fallback:", pdfErr?.message);
    }

    // 2. Fallback: raw stream parsing if pdfjs-dist failed or returned empty text
    if (!extracted || !extracted.trim()) {
      try {
        extracted = extractPdfRawTextFallback(bytes);
      } catch (fallbackErr: any) {
        console.warn("[CvTextExtraction] Fallback stream parsing error:", fallbackErr?.message);
      }
    }
  }

  const normalized = (extracted || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return { text: "", truncated: false };
  }
  return {
    text: normalized.slice(0, maxCvTextCharacters),
    truncated: normalized.length > maxCvTextCharacters,
  };
}
