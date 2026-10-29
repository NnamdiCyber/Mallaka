import { AppError } from "@mallaka/shared";
import type { CheckoutProvider } from "./types.js";

/**
 * Paystack hosted checkout (README 12). Only a reference, amount and a
 * synthetic non-personal email are sent. No card data touches Mallaka.
 */
export class PaystackCheckout implements CheckoutProvider {
  constructor(
    private readonly secretKey: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async initialize(input: { reference: string; amountNaira: string; riderRef: string }): Promise<{ checkoutUrl: string }> {
    const kobo = Math.round(Number(input.amountNaira) * 100);
    const res = await this.fetchFn("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `rider-${input.riderRef}@riders.mallaka.invalid`,
        amount: kobo,
        currency: "NGN",
        reference: input.reference,
      }),
    });
    if (!res.ok) throw new AppError("The payment provider is unavailable", 502, "PROVIDER_UNAVAILABLE");
    const body = (await res.json()) as { data?: { authorization_url?: string } };
    if (!body.data?.authorization_url) throw new AppError("The payment provider is unavailable", 502, "PROVIDER_UNAVAILABLE");
    return { checkoutUrl: body.data.authorization_url };
  }
}

/** Dev-only stand-in used when no PAYSTACK_SECRET_KEY is configured. Never charges anything. */
export class DevCheckout implements CheckoutProvider {
  constructor(private readonly baseUrl = "http://localhost:3000") {}
  async initialize(input: { reference: string }): Promise<{ checkoutUrl: string }> {
    return { checkoutUrl: `${this.baseUrl}/dev-checkout?reference=${encodeURIComponent(input.reference)}` };
  }
}
