import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret, isEncryptionEnabled } from "./crypto.server";

describe("crypto.server (at-rest secret encryption)", () => {
  const saved = process.env.CREDENTIALS_ENC_KEY;
  afterEach(() => {
    process.env.CREDENTIALS_ENC_KEY = saved;
  });

  describe("with encryption enabled", () => {
    beforeEach(() => {
      process.env.CREDENTIALS_ENC_KEY = "unit-test-encryption-key";
    });

    it("reports enabled", () => {
      expect(isEncryptionEnabled()).toBe(true);
    });

    it("round-trips a secret and produces opaque, marked, non-deterministic ciphertext", () => {
      const secret = "sb_service_role_abc123";
      const enc = encryptSecret(secret);
      expect(enc).not.toBe(secret);
      expect(enc.startsWith("enc:v1:")).toBe(true);
      expect(decryptSecret(enc)).toBe(secret);
      // random IV → different ciphertext each time, same plaintext
      expect(encryptSecret(secret)).not.toBe(enc);
    });

    it("passes through legacy plaintext on decrypt", () => {
      expect(decryptSecret("legacy-plaintext-key")).toBe("legacy-plaintext-key");
    });

    it("preserves null", () => {
      expect(decryptSecret(null)).toBeNull();
    });

    it("fails to decrypt tampered ciphertext (GCM auth)", () => {
      const enc = encryptSecret("secret");
      const tampered = enc.slice(0, -4) + (enc.endsWith("AAAA") ? "BBBB" : "AAAA");
      expect(() => decryptSecret(tampered)).toThrow();
    });
  });

  describe("with encryption disabled (no key)", () => {
    beforeEach(() => {
      delete process.env.CREDENTIALS_ENC_KEY;
    });

    it("reports disabled and is a no-op on write (current behavior preserved)", () => {
      expect(isEncryptionEnabled()).toBe(false);
      expect(encryptSecret("plain")).toBe("plain");
      expect(decryptSecret("plain")).toBe("plain");
    });
  });
});
