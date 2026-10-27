export type LogLevel = "debug" | "info" | "warn" | "error";

const PHONE_REGEX = /(\+?234[0-9]{10}|0[789][01][0-9]{8}|\+?[1-9]\d{9,14})/g;
const STELLAR_SECRET_REGEX = /S[A-Z0-9]{55}/g;
const SECRET_KEY_NAMES = new Set([
  "secret",
  "key",
  "password",
  "token",
  "auth",
  "authorization",
  "hash",
  "passphrase",
  "private_key",
  "secret_key",
  "paystack_secret_key",
  "flutterwave_secret_hash",
  "africastalking_api_key",
  "lock_vendor_api_key",
  "jwt_secret",
]);

/**
 * Recursively redacts sensitive data (secrets and phone numbers) from any value.
 */
export function redact(value: unknown, keyName = ""): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  const lowerKey = keyName.toLowerCase();
  if (
    SECRET_KEY_NAMES.has(lowerKey) ||
    lowerKey.includes("secret") ||
    lowerKey.includes("password") ||
    lowerKey.includes("private")
  ) {
    return "[REDACTED_SECRET]";
  }

  if (typeof value === "string") {
    let sanitized = value.replace(STELLAR_SECRET_REGEX, "[REDACTED_SECRET]");
    sanitized = sanitized.replace(PHONE_REGEX, "[REDACTED_PHONE]");
    return sanitized;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, keyName));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = redact(v, k);
    }
    return result;
  }

  return value;
}

export class Logger {
  constructor(private readonly serviceName: string) {}

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const entry = {
      timestamp: new Date().toISOString(),
      service: this.serviceName,
      level,
      message: typeof message === "string" ? (redact(message) as string) : message,
      ...(meta ? (redact(meta) as Record<string, unknown>) : {}),
    };

    const serialized = JSON.stringify(entry);
    if (level === "error") {
      process.stderr.write(serialized + "\n");
    } else {
      process.stdout.write(serialized + "\n");
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }
}

export function createLogger(serviceName: string): Logger {
  return new Logger(serviceName);
}
