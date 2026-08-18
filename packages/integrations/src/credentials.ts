import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const b64 = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and set it " +
        "in your environment before storing marketplace credentials (§39).",
    );
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).");
  }
  return key;
}

/**
 * Field-level encryption for OAuth access/refresh tokens (§39: "Tokens e
 * secrets devem ser armazenados de forma segura"). Ciphertext, IV and auth
 * tag are packed into one base64 string so it fits a single database
 * column (`MarketplaceCredential.encryptedAccessToken` /
 * `encryptedRefreshToken`).
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptSecret(packed: string): string {
  const buf = Buffer.from(packed, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/**
 * Never log full tokens (§39). Use this in IntegrationLog entries and
 * error messages instead of the raw secret.
 */
export function redactSecret(secret: string | undefined | null): string {
  if (!secret) return "(none)";
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}
