import { createHash, randomBytes } from "node:crypto";

/** Raw token goes in the e-mail link; only its hash is ever stored (§38 — secure handling of sensitive tokens). */
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
