// AES-256-GCM encryption for secrets at rest, such as Pine handles in missions.pine_enc.
// The key comes from ENCRYPTION_KEY: 32 random bytes, base64 (plan 4.4).

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";

/** Reads and validates ENCRYPTION_KEY. Throws a clear error when it is missing or the wrong size. */
export function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not set. Put 32 random bytes, base64, in .env.local.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}.`);
  }
  return key;
}

/**
 * Encrypts a UTF-8 string. Returns a compact token: `v1.<iv>.<ciphertext>.<tag>`,
 * each part base64url. A fresh random IV is used on every call.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".");
}

/**
 * Decrypts a token made by `encrypt`. Throws when the token is malformed,
 * was made with a different key, or was changed after encryption.
 */
export function decrypt(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Cannot decrypt: the token format is not recognized.");
  }
  const iv = Buffer.from(parts[1]!, "base64url");
  const ciphertext = Buffer.from(parts[2]!, "base64url");
  const tag = Buffer.from(parts[3]!, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Cannot decrypt: the token format is not recognized.");
  }
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
