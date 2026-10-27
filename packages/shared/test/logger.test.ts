import { describe, it } from "node:test";
import assert from "node:assert";
import { redact, createLogger } from "../src/logger.js";

describe("logger and redact", () => {
  it("redacts sensitive keys regardless of value type", () => {
    const input = {
      user: "rider_123",
      secret: "super_secret_token_value",
      nested: {
        paystack_secret_key: "sk_live_1234567890",
        safe_info: "visible_value",
      },
    };

    const sanitized = redact(input) as any;
    assert.strictEqual(sanitized.user, "rider_123");
    assert.strictEqual(sanitized.secret, "[REDACTED_SECRET]");
    assert.strictEqual(sanitized.nested.paystack_secret_key, "[REDACTED_SECRET]");
    assert.strictEqual(sanitized.nested.safe_info, "visible_value");
  });

  it("redacts phone numbers in string values", () => {
    const message = "Customer reached at +2348012345678 and alternative 08123456789";
    const sanitized = redact(message) as string;
    assert(!sanitized.includes("+2348012345678"));
    assert(!sanitized.includes("08123456789"));
    assert(sanitized.includes("[REDACTED_PHONE]"));
  });

  it("redacts stellar secret seed keys in string values", () => {
    // 56 char ed25519 seed starting with S
    const dummySeed = "SB334FAKE4SECRET4KEY4MALLAKA4STELLAR4SEED4TEST4DEV4000000";
    const message = `Signing with seed ${dummySeed} on testnet`;
    const sanitized = redact(message) as string;
    assert(!sanitized.includes(dummySeed));
    assert(sanitized.includes("[REDACTED_SECRET]"));
  });

  it("creates logger and produces valid JSON logs", () => {
    const logger = createLogger("test-service");
    // intercept stdout
    let output = "";
    const originalWrite = process.stdout.write;
    try {
      process.stdout.write = ((chunk: any) => {
        output += chunk;
        return true;
      }) as any;

      logger.info("Test message", { riderPhone: "+2348098765432" });
    } finally {
      process.stdout.write = originalWrite;
    }

    const parsed = JSON.parse(output.trim());
    assert.strictEqual(parsed.service, "test-service");
    assert.strictEqual(parsed.level, "info");
    assert.strictEqual(parsed.message, "Test message");
    assert.strictEqual(parsed.riderPhone, "[REDACTED_PHONE]");
  });
});
