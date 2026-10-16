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
          let pageText = "";
          let lastItem: any = null;

          for (const rawItem of content.items) {
            if (!("str" in rawItem) || typeof rawItem.str !== "string") continue;
            const item = rawItem as any;
            if (!item.str && !item.hasEOL) continue;

            if (lastItem) {
              const transform = item.transform;
              const lastTransform = lastItem.transform;
              if (Array.isArray(transform) && Array.isArray(lastTransform)) {
                const yDiff = Math.abs(transform[5] - lastTransform[5]);
                if (yDiff > 5) {
                  pageText += "\n";
                } else {
                  const fontHeight = Math.abs(transform[0]) || Math.abs(transform[3]) || 10;
                  const width = typeof lastItem.width === "number" && lastItem.width > 0 ? lastItem.width : 0;
                  const xGap = transform[4] - (lastTransform[4] + width);
                  const minWordSpace = Math.max(fontHeight * 0.32, 5.2);
                  if (xGap > minWordSpace && !pageText.endsWith(" ") && !item.str.startsWith(" ")) {
                    pageText += " ";
                  }
                }
              } else if (lastItem.hasEOL) {
                pageText += "\n";
              }
            }

            pageText += item.str;
            if (item.hasEOL && !pageText.endsWith("\n")) {
              pageText += "\n";
            }
            lastItem = item;
          }

          if (pageText.trim()) {
            pages.push(pageText.trim());
          }
        }
        extracted = pages.join("\n\n");
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

  // Normalize spaces and heal fragmented character runs while preserving structural line breaks
  const normalized = healBrokenCvText(extracted || "");

  if (!normalized) {
    return { text: "", truncated: false };
  }
  return {
    text: normalized.slice(0, maxCvTextCharacters),
    truncated: normalized.length > maxCvTextCharacters,
  };
}

/**
 * Universal text healer for OCR artifacts and kerning fragmentation
 */
export function healBrokenCvText(raw: string): string {
  let s = (raw || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // 1. Common document & qualification headers
  s = s
    .replace(/\bC\s*u\s*r\s*r\s*i\s*c\s*u\s*l\s*u\s*m\s+V\s*i\s*t\s*a\s*e\b/gi, "Curriculum Vitae")
    .replace(/\bC\s*u\s*r\s*r\s*i\s*c\s*u\s*l\s*u\s*m\b/gi, "Curriculum")
    .replace(/\bV\s*i\s*t\s*a\s*e\b/gi, "Vitae")
    .replace(/\bB\s*i\s*o\s*[- ]\s*d\s*a\s*t\s*a\b/gi, "Bio-data")
    .replace(/\bD\s*r\s*\.?\s*/gi, "Dr. ")
    .replace(/\bP\s*r\s*o\s*f\s*\.?\s*/gi, "Prof. ")
    .replace(/\b(Mr|Mrs|Ms|Engr|Barr)\s*\.\s*/gi, "$1. ")
    .replace(/M\s*\.?\s*B\s*\.?\s*,?\s*B\s*\.?\s*S\.?/gi, "M.B., B.S.")
    .replace(/F\s*W\s*A\s*C\s*S/gi, "FWACS")
    .replace(/F\s*R\s*C\s*S/gi, "FRCS")
    .replace(/F\s*A\s*C\s*S/gi, "FACS")
    .replace(/A\s*C\s*C\s*A/gi, "ACCA")
    .replace(/C\s*P\s*A/gi, "CPA")
    .replace(/P\s*M\s*P/gi, "PMP")
    .replace(/L\s*L\s*\.?\s*B\.?/gi, "LL.B")
    .replace(/L\s*L\s*\.?\s*M\.?/gi, "LL.M");

  // Mark multi-space gaps between words or case transitions (e.g. "o   B") before healing single letter kerning
  s = s.replace(/([A-Za-z])\s{2,}([A-Za-z])/g, "$1 _WB_ $2");
  s = s.replace(/([a-z])\s+([A-Z])/g, "$1 _WB_ $2");

  // 2. Heal broken runs of individual single letters: e.g. "B E L L O" -> "BELLO", "O l u w a" -> "Oluwa"
  s = s.replace(/\b([A-Za-z])(?:\s+([A-Za-z]))+\b/g, (match) => {
    const parts = match.split(/\s+/);
    const validSingles = new Set(["a", "i"]);
    if (parts.length > 2 || parts.every(p => !validSingles.has(p.toLowerCase()))) {
      return parts.join("");
    }
    return match;
  });

  // Restore word breaks
  s = s.replace(/\s*_WB_\s*/g, " ");

  // 3. Heal fragmented syllables separated by single spaces: e.g. "Ol u w asom id oyin" -> "Oluwasomidoyin"
  const validEnglishWords = new Set([
    "a", "i", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is",
    "it", "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we", "for",
    "and", "the", "but", "not", "you", "all", "any", "can", "had", "her", "was",
    "one", "our", "out", "day", "get", "has", "him", "his", "how", "man", "new",
    "now", "old", "see", "two", "way", "who", "boy", "did", "its", "let", "put",
    "say", "she", "too", "use"
  ]);

  const tokens = s.split(/(\s+|[.,:;()\\\/])/);
  const out: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;

    if (/^\s+$/.test(t)) {
      const prev = out[out.length - 1];
      const next = tokens[i + 1];

      if (prev && next && /^[A-Za-z]+$/.test(prev) && /^[A-Za-z]+$/.test(next)) {
        const prevLower = prev.toLowerCase();
        const nextLower = next.toLowerCase();

        const prevIsSingle = prev.length === 1 && !validEnglishWords.has(prevLower);
        const nextIsSingle = next.length === 1 && !validEnglishWords.has(nextLower);
        const bothSingle = prev.length === 1 && next.length === 1;
        const nextIsFragment = /^[a-z]/.test(next) && (
          next.length <= 3 && !validEnglishWords.has(nextLower)
        );
        const prevIsFragment = prev.length <= 3 && !validEnglishWords.has(prevLower) && /^[a-z]/.test(next);

        if (bothSingle || prevIsSingle || nextIsSingle || nextIsFragment || prevIsFragment) {
          out[out.length - 1] = prev + next;
          i++;
          continue;
        }
      }
      out.push(t);
    } else {
      out.push(t);
    }
  }

  let result = out.join("");

  // 4. Clean up address fragments and common word endings e.g. "S tre e t" -> "Street", "E sta te" -> "Estate"
  result = result
    .replace(/\bS\s*tre\s*e\s*t\b/gi, "Street")
    .replace(/\bE\s*sta\s*te\b/gi, "Estate")
    .replace(/\bE\s*x\s*t\b/gi, "Ext")
    .replace(/\b([A-Za-z]{2,})\s+([a-z]{1,2})\b/g, (m, w, f) => {
      if (!validEnglishWords.has(f.toLowerCase())) {
        return w + f;
      }
      return m;
    });

  return result.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
