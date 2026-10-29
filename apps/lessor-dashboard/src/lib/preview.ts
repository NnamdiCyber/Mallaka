import { fromCents, toCents } from "./money";

export interface PreviewInput {
  totalPrice: string;
  deposit: string;
  installment: string;
  interval: "daily" | "weekly";
  graceDays: number;
  repossessionWaitDays: number;
}

export interface Preview {
  valid: boolean;
  problem?: string;
  /** What the rider pays in total over the life of the lease. No fees: late fees are off (README 8.4). */
  totalCost: string;
  deposit: string;
  payable: string;
  installments: number;
  finalInstallment: string;
  durationDays: number;
}

/**
 * Total cost of ownership preview, mirroring the contract rules:
 * installment count uses ceil with the remainder absorbed in the final installment (ADR-006).
 * Fixed intervals only (seasonal schedules are Phase 6).
 */
export function previewLease(i: PreviewInput): Preview {
  const empty = { totalCost: "0.00", deposit: "0.00", payable: "0.00", installments: 0, finalInstallment: "0.00", durationDays: 0 };
  const ok = (s: string) => /^\d+(\.\d{1,2})?$/.test(s);
  if (!ok(i.totalPrice) || !ok(i.deposit) || !ok(i.installment)) return { valid: false, problem: "Enter amounts as numbers", ...empty };
  const total = toCents(i.totalPrice);
  const deposit = toCents(i.deposit);
  const inst = toCents(i.installment);
  if (total <= 0n || inst <= 0n) return { valid: false, problem: "Price and installment must be more than zero", ...empty };
  if (deposit >= total) return { valid: false, problem: "The deposit must be less than the price", ...empty };
  const payable = total - deposit;
  if (inst > payable) return { valid: false, problem: "The installment cannot be more than the amount left after the deposit", ...empty };
  const count = (payable + inst - 1n) / inst;
  const rem = payable % inst;
  const days = Number(count) * (i.interval === "daily" ? 1 : 7);
  return {
    valid: true,
    totalCost: fromCents(total),
    deposit: fromCents(deposit),
    payable: fromCents(payable),
    installments: Number(count),
    finalInstallment: fromCents(rem === 0n ? inst : rem),
    durationDays: days,
  };
}
