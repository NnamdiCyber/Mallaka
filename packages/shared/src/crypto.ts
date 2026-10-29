import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for AES-GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a 32-byte AES key from a secret string using SHA-256.
 */
export function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export interface EncryptedPayload {
  iv: string; // hex
  tag: string; // hex
  data: string; // hex
}

/**
 * Encrypts arbitrary contact data (e.g. { phone, name, email }) at rest using AES-256-GCM.
 * Returns a serialized string format: `iv:authTag:encryptedHex`.
 */
export function encryptContactInfo(data: unknown, secret: string): string {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const plaintext = Buffer.from(JSON.stringify(data), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts contact data at rest encrypted with `encryptContactInfo`.
 */
export function decryptContactInfo<T = unknown>(encryptedStr: string, secret: string): T {
  const parts = encryptedStr.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted contact info format. Expected iv:tag:data");
  }

  const [ivHex, tagHex, dataHex] = parts;
  const key = deriveKey(secret);
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const encryptedData = Buffer.from(dataHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

/**
 * Keyed, deterministic hash of a phone number. Used to look a user up at OTP
 * login without storing the number in plaintext (contact_info_encrypted is
 * randomised and cannot be queried). Numbers are normalised to digits only.
 */
export function phoneHash(phone: string, secret: string): string {
  const normalised = phone.replace(/\D/g, "");
  return crypto.createHmac("sha256", deriveKey(secret)).update(normalised, "utf8").digest("hex");
}
