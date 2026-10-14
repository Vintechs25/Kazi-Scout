import mammoth from "mammoth";

const maxPages = 60;
export const maxCvTextCharacters = 60_000;

export async function extractCvText(
  bytes: Buffer,
  fileType: "pdf" | "docx",
): Promise<{ text: string; truncated: boolean }> {
  let extracted: string;

  if (fileType === "docx") {
    const result = await mammoth.extractRawText({ buffer: bytes });
    extracted = result.value;
  } else {
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
      await loadingTask.destroy();
    }
  }

  const normalized = extracted.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return { text: "", truncated: false };
  }
  return {
    text: normalized.slice(0, maxCvTextCharacters),
    truncated: normalized.length > maxCvTextCharacters,
  };
}
