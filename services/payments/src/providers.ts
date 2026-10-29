import { toScaled, fromScaled } from "@mallaka/shared";

export type Provider = "paystack" | "flutterwave";

/** A provider payment that is a verified-successful naira payment. */
export interface ProviderPayment {
  provider: Provider;
  reference: string;
  /** Naira amount as a 2-decimal string. */
  nairaAmount: string;
}

export type ParseResult =
  | { kind: "payment"; payment: ProviderPayment }
  | { kind: "ignored"; reason: string };

/**
 * Paystack `charge.success` event. Amount is in kobo.
 * No card data is read or stored: only reference, status, currency and amount.
 */
export function parsePaystack(body: unknown): ParseResult {
  const b = body as { event?: string; data?: { status?: string; reference?: string; currency?: string; amount?: number } };
  if (b?.event !== "charge.success") return { kind: "ignored", reason: `event ${b?.event ?? "unknown"}` };
  const d = b.data;
  if (!d || d.status !== "success") return { kind: "ignored", reason: "status not success" };
  if (d.currency !== "NGN") return { kind: "ignored", reason: "currency not NGN" };
  if (typeof d.reference !== "string" || !d.reference) return { kind: "ignored", reason: "missing reference" };
  if (typeof d.amount !== "number" || !Number.isInteger(d.amount) || d.amount <= 0) {
    return { kind: "ignored", reason: "invalid amount" };
  }
  return {
    kind: "payment",
    payment: { provider: "paystack", reference: d.reference, nairaAmount: fromScaled(BigInt(d.amount), 2) },
  };
}

/** Flutterwave `charge.completed` event. Amount is in naira. `tx_ref` is our reference. */
export function parseFlutterwave(body: unknown): ParseResult {
  const b = body as { event?: string; data?: { status?: string; tx_ref?: string; currency?: string; amount?: number | string } };
  if (b?.event !== "charge.completed") return { kind: "ignored", reason: `event ${b?.event ?? "unknown"}` };
  const d = b.data;
  if (!d || d.status !== "successful") return { kind: "ignored", reason: "status not successful" };
  if (d.currency !== "NGN") return { kind: "ignored", reason: "currency not NGN" };
  if (typeof d.tx_ref !== "string" || !d.tx_ref) return { kind: "ignored", reason: "missing reference" };
  let scaled: bigint;
  try {
    scaled = toScaled(d.amount as number | string, 2);
  } catch {
    return { kind: "ignored", reason: "invalid amount" };
  }
  if (scaled <= 0n) return { kind: "ignored", reason: "invalid amount" };
  return {
    kind: "payment",
    payment: { provider: "flutterwave", reference: d.tx_ref, nairaAmount: fromScaled(scaled, 2) },
  };
}
