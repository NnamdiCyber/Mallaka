import type { Lease, LeaseStatus } from "../src/lib/types";

const m = (naira: string, token = "0.00") => ({ naira, token });

export function lease(status: LeaseStatus, over: Partial<Lease> = {}): Lease {
  return {
    id: "7",
    status,
    terms: {
      totalPrice: m("1500000.00", "1000.00"),
      deposit: m("150000.00", "100.00"),
      installment: m("15000.00", "10.00"),
      intervalSeconds: 86_400,
      graceSeconds: 2 * 86_400,
      repossessionWaitSeconds: 3 * 86_400,
    },
    balance: { paid: m("450000.00"), remaining: m("900000.00"), arrears: m("0.00") },
    nextDue: 1_793_000_000, // 26 Oct 2026
    graceEnds: null,
    progressPercent: 33,
    asset: { type: "motorcycle" },
    source: "chain",
    stale: false,
    updatedAt: "2026-10-25T10:00:00.000Z",
    ...over,
  };
}

export const grace = () =>
  lease("Grace", { graceEnds: 1_793_172_800, balance: { paid: m("450000.00"), remaining: m("900000.00"), arrears: m("15000.00") } });
export const defaulted = () =>
  lease("Defaulted", { balance: { paid: m("450000.00"), remaining: m("900000.00"), arrears: m("45000.00") } });
export const completed = () =>
  lease("Completed", { nextDue: null, progressPercent: 100, balance: { paid: m("1350000.00"), remaining: m("0.00"), arrears: m("0.00") } });
