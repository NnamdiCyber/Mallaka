import { describe, it } from "node:test";
import assert from "node:assert";
import { encryptContactInfo, decryptContactInfo, deriveKey } from "../src/crypto.js";

describe("crypto application-level encryption", () => {
  const secret = "test_jwt_secret_phrase_for_encryption_keys";

  it("derives consistent 32-byte key", () => {
    const key1 = deriveKey(secret);
    const key2 = deriveKey(secret);
    assert.strictEqual(key1.length, 32);
    assert.deepStrictEqual(key1, key2);
  });

  it("encrypts and decrypts contact info cleanly", () => {
    const contactInfo = {
      fullName: "Musa Danladi",
      phoneNumber: "+2348030001122",
      address: "12 Kano Road, Kaduna",
      emergencyContact: "+2348020003344",
    };

    const encrypted = encryptContactInfo(contactInfo, secret);
    assert.strictEqual(typeof encrypted, "string");
    assert(encrypted.includes(":"));
    assert(!encrypted.includes("Musa Danladi"));
    assert(!encrypted.includes("+2348030001122"));

    const decrypted = decryptContactInfo<typeof contactInfo>(encrypted, secret);
    assert.deepStrictEqual(decrypted, contactInfo);
  });

  it("fails to decrypt with incorrect secret key", () => {
    const encrypted = encryptContactInfo({ test: "data" }, secret);
    assert.throws(() => {
      decryptContactInfo(encrypted, "wrong_secret_key");
    });
  });

  it("fails to decrypt tampered ciphertext", () => {
    const encrypted = encryptContactInfo({ test: "data" }, secret);
    const parts = encrypted.split(":");
    // tamper with data hex
    parts[2] = (parts[2].slice(0, -2) + "ff");
    const tampered = parts.join(":");

    assert.throws(() => {
      decryptContactInfo(tampered, secret);
    });
  });
});
