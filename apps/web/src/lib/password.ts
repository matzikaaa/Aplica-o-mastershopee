import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing (§7, §38): scrypt (Node's built-in, no extra native
 * dependency) with a random salt per user, stored as `salt:hash` — same
 * format used by packages/database/prisma/seed.ts so seeded demo users
 * authenticate through the exact same code path as real signups.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
