// At-rest encryption for stored clone credentials (service_role_key, db_pass).
//
// Opt-in and backward-compatible:
//   - If CREDENTIALS_ENC_KEY is unset, encryptSecret is a no-op (stores plaintext,
//     i.e. current behavior) and decryptSecret returns values unchanged.
//   - If set, new writes are AES-256-GCM encrypted with an "enc:v1:" marker.
//     decryptSecret transparently handles both encrypted and legacy-plaintext
//     values, so existing rows keep working and get encrypted on next write.
import crypto from "crypto";

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

// Derive a stable 32-byte AES key from the configured secret (any length).
function getKey(): Buffer | null {
  const raw = process.env.CREDENTIALS_ENC_KEY;
  if (!raw) return null;
  return crypto.createHash("sha256").update(raw).digest();
}

export function isEncryptionEnabled(): boolean {
  return getKey() !== null;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext; // encryption disabled — preserve current behavior
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(value: string): string;
export function decryptSecret(value: null): null;
export function decryptSecret(value: string | null): string | null;
export function decryptSecret(value: string | null): string | null {
  if (value == null) return value;
  if (!value.startsWith(PREFIX)) return value; // legacy plaintext (or encryption off)
  const key = getKey();
  if (!key) {
    throw new Error("CREDENTIALS_ENC_KEY is required to decrypt an encrypted secret");
  }
  const buf = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
