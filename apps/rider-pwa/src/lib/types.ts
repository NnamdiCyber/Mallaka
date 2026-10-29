/** Shapes returned by services/api (see docs/openapi.json). Only the fields the rider app uses. */
export type LeaseStatus = "Pending" | "Active" | "Grace" | "Defaulted" | "Completed" | "Repossessed" | "Cancelled";

export interface Money {
  /** Settlement-currency amount. Never shown to riders. */
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
  asset: { type: string };
  source: "cache" | "chain";
  stale: boolean;
  updatedAt: string;
}

export interface Payment {
  id: string;
  nairaAmount: string;
  status: "processing" | "settled";
  createdAt: string;
  settledAt: string | null;
  excessFlagged: boolean;
}

export interface Receipt {
  receiptNumber: string;
  paidAt: string;
  nairaAmount: string;
  appliedNairaAmount: string;
  excessNairaAmount: string;
  paymentMethod: string;
  balanceRemaining: { naira: string };
  progressPercent: number;
  assetType: string;
  lessorName: string;
}
