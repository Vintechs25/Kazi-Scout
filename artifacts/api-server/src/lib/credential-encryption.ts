import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const algorithm = "aes-256-gcm";
const version = "v1";

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET || "dev_secret_key_1234567890abcdefghijklmnopqrstuv";
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.from("ai-job-agent-provider-credentials", "utf8"),
      Buffer.from("integration-settings-v1", "utf8"),
      32,
    ),
  );
}

export function encryptCredentials(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    version,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptCredentials<T>(stored: string): T {
  const [storedVersion, ivText, tagText, ciphertextText, extra] = stored.split(".");
  if (
    storedVersion !== version ||
    !ivText ||
    !tagText ||
    !ciphertextText ||
    extra
  ) {
    throw new Error("Saved credentials are invalid.");
  }

  try {
    const decipher = createDecipheriv(
      algorithm,
      encryptionKey(),
      Buffer.from(ivText, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as T;
  } catch {
    throw new Error("Saved credentials cannot be decrypted.");
  }
}
