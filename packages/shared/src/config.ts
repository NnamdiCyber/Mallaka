import { z } from "zod";

/**
 * Exact environment variables specified in README section 16.
 * No extraneous variables are permitted.
 */
export const ConfigSchema = z.object({
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]),
  SOROBAN_RPC_URL: z.string().url("SOROBAN_RPC_URL must be a valid URL"),
  HORIZON_URL: z.string().url().optional(),
  LEASE_CONTRACT_ID: z.string().min(1, "LEASE_CONTRACT_ID is required"),
  TITLE_REGISTRY_CONTRACT_ID: z.string().optional(),
  PAYMENT_TOKEN_CONTRACT_ID: z.string().optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().optional(),
  KMS_KEY_ID: z.string().optional(),
  SPONSOR_PUBLIC_KEY: z.string().optional(),
  SPONSOR_MIN_BALANCE: z
    .string()
    .optional()
    .transform((val) => (val !== undefined && val !== "" ? Number(val) : undefined))
    .pipe(z.number().nonnegative().optional()),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_SECRET_HASH: z.string().optional(),
  AFRICASTALKING_API_KEY: z.string().optional(),
  AFRICASTALKING_USERNAME: z.string().optional(),
  LOCK_VENDOR_API_URL: z.string().url().optional(),
  LOCK_VENDOR_API_KEY: z.string().optional(),
  MQTT_URL: z.string().optional(),
  KEEPER_INTERVAL_SECONDS: z
    .string()
    .optional()
    .transform((val) => (val !== undefined && val !== "" ? parseInt(val, 10) : 60))
    .pipe(z.number().positive()),
  JWT_SECRET: z.string().optional(),
  /**
   * ADDITIVE to README 16 (see ADR-012): manual locks on leases whose remaining
   * balance (token base units) exceeds this need a second approver. Default 0 = always.
   */
  MANUAL_LOCK_APPROVAL_THRESHOLD: z
    .string()
    .optional()
    .transform((val) => (val !== undefined && val !== "" ? val : undefined))
    .pipe(z.string().regex(/^\d+$/, "must be a non-negative integer").optional()),
  SENTRY_DSN: z.string().optional(),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

/**
 * Loads and validates configuration from environment variables.
 * Fails fast with clear and descriptive error messages if invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `[ConfigError] Invalid environment configuration (see README section 16):\n${errorDetails}`
    );
  }
  return result.data;
}
