import type { Queryable, LeaseChain } from "@mallaka/shared";
import type { FxRateProvider } from "@mallaka/payments";
import type { PayJobQueue } from "@mallaka/payments";

export type Role = "rider" | "lessor_staff" | "admin";

export interface AuthUser {
  id: string;
  role: Role;
  lessorId?: string;
}

/** Starts a naira checkout with a payment provider and returns the hosted checkout URL. */
export interface CheckoutProvider {
  initialize(input: { reference: string; amountNaira: string; riderRef: string }): Promise<{ checkoutUrl: string }>;
}

export interface OtpSender {
  sendOtp(phone: string, code: string): Promise<void>;
}

export interface ApiDeps {
  db: Queryable;
  chain: LeaseChain;
  otp: OtpSender;
  fx: FxRateProvider;
  /** Queue the payments service webhook handler uses to apply payments on-chain. */
  payQueue: PayJobQueue;
  checkout: Partial<Record<"paystack" | "flutterwave", CheckoutProvider>>;
  /** Secret for JWT signing AND contact-info encryption/phone hashing. Must be 32+ chars. */
  jwtSecret: string;
  paystackSecretKey?: string;
  flutterwaveSecretHash?: string;
  contracts: { titleRegistry: string; token: string };
  /** README 19 two-person rule: remaining balance (token base units) above which a manual lock needs a second approver. */
  manualLockApprovalThreshold: bigint;
  /** A cached lease older than this is re-read from the chain. */
  cacheStaleSeconds?: number;
  rateLimit?: { max: number; timeWindow: string };
  /** Overridable for tests. */
  now?: () => Date;
  generateOtp?: () => string;
}
