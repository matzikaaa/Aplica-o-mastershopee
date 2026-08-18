import { describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret, redactSecret } from "../credentials";

describe("credential encryption (§39 — never store tokens in plaintext)", () => {
  it("round-trips a secret through encrypt/decrypt", () => {
    const secret = "shpee_access_token_super_secret_value";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("produces different ciphertext each time (random IV) even for the same input", () => {
    const secret = "same-input-twice";
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
  });

  it("fails to decrypt tampered ciphertext (authenticated encryption)", () => {
    const encrypted = encryptSecret("some-token");
    const tampered = encrypted.slice(0, -4) + "abcd";
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("redacts secrets for safe logging instead of exposing the full value", () => {
    expect(redactSecret("abcd1234efgh5678")).toBe("abcd...5678");
    expect(redactSecret(undefined)).toBe("(none)");
  });
});
