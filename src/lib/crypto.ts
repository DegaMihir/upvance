import crypto from "node:crypto";

/**
 * AES-256-GCM encryption for secrets stored in the database
 * (application passwords, API keys entered in Settings).
 * The key comes from APP_ENCRYPTION_KEY in .env and never leaves this machine.
 */
function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is missing from .env. Run `npm run setup`.");
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const [v, ivB, tagB, dataB] = payload.split(":");
  if (v !== "v1" || !ivB || !tagB || !dataB) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Mask a secret for display, e.g. "••••abcd". Never show full keys in the UI. */
export function maskSecret(s: string | null | undefined) {
  if (!s) return "";
  return "••••" + s.slice(-4);
}
