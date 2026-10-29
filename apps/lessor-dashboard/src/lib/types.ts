/** Shapes returned by services/api (see docs/openapi.json). */
export type LeaseStatus = "Pending" | "Active" | "Grace" | "Defaulted" | "Completed" | "Repossessed" | "Cancelled";
export type Role = "rider" | "lessor_staff" | "admin";

export interface Money {
  /** Settlement currency (USD) amount. */
  token: string;
  naira: string;
}

export interface Lease {
  id: string;
  status: LeaseStatus;
  terms: {
    totalPrice: Money;
    deposit: Money;
    installment: Money;
    intervalSeconds: number;
    graceSeconds: number;
    repossessionWaitSeconds: number;
  };
  balance: { paid: Money; remaining: Money; arrears: Money };
  nextDue?: number | null;
  graceEnds?: number | null;
  progressPercent: number;
  asset: { type: string; deviceId?: string };
  lessee?: { id: string; phoneLast4?: string };
  source: "cache" | "chain";
  stale: boolean;
  updatedAt: string;
}

export interface Payment {
  id: string;
  nairaAmount: string;
  status: "processing" | "settled";
  provider: string;
  createdAt: string;
  settledAt: string | null;
  excessFlagged: boolean;
  txHash?: string;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  resource: string;
  details: Record<string, unknown>;
  ipAddress?: string | null;
  createdAt: string;
}

export interface CommandResult {
  status: "queued" | "approval_required";
  commandId?: string;
  approvalId?: string;
  message: string;
}

export interface CreateLeaseInput {
  asset: { vinOrSerial: string; assetType: "motorcycle" | "tricycle" | "farm_equipment"; deviceId: string; photoRefs?: string[] };
  lessee: { phone: string; address?: string };
  totalPrice: string;
  deposit: string;
  installment: string;
  interval: "daily" | "weekly";
  graceDays: number;
  repossessionWaitDays: number;
}
