import { createHash } from "node:crypto";
import type { JobRecord } from "@workspace/db";

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\blimited\b|\bltd\b|\bllc\b|\bplc\b|\bgmbh\b/g, " ")
    .replace(/\bincorporated\b|\binc\b|\bcorporation\b|\bcorp\b/g, " ")
    .replace(/\bcompany\b|\bco\b|\bholdings\b|\bgroup\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeCompany(value: string): string {
  return normalizeText(value);
}

export function fingerprintJob(input: {
  company: string;
  title: string;
  location: string | null;
  description: string;
}): string {
  const canonical = JSON.stringify([
    normalizeCompany(input.company),
    normalizeText(input.title),
    normalizeText(input.location ?? ""),
    normalizeText(input.description),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

function tokenSimilarity(left: string, right: string): number {
  const a = new Set(normalizeText(left).split(" ").filter((word) => word.length > 1));
  const b = new Set(normalizeText(right).split(" ").filter((word) => word.length > 1));
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const word of a) {
    if (b.has(word)) overlap += 1;
  }
  return overlap / new Set([...a, ...b]).size;
}

export function isPotentialDuplicate(left: JobRecord, right: JobRecord): boolean {
  if (left.id === right.id || left.normalizedCompany !== right.normalizedCompany) {
    return false;
  }
  const sameLocation =
    left.normalizedLocation === right.normalizedLocation ||
    tokenSimilarity(left.location ?? "", right.location ?? "") >= 0.65;
  if (!sameLocation) return false;

  const titleSimilarity = tokenSimilarity(left.title, right.title);
  const descriptionSimilarity = tokenSimilarity(left.description, right.description);
  return (
    (titleSimilarity >= 0.75 && descriptionSimilarity >= 0.55) ||
    (titleSimilarity >= 0.4 && descriptionSimilarity >= 0.85)
  );
}
