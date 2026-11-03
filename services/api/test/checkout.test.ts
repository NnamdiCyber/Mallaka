import { describe, it } from "node:test";
import assert from "node:assert";
import { FlutterwaveCheckout, PaystackCheckout } from "../src/checkout.js";

describe("Checkout providers", () => {
  it("PaystackCheckout initializes a payment transaction", async () => {
    let capturedUrl = "";
    let capturedBody: any = null;
    const mockFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return {
        ok: true,
        json: async () => ({
          status: "success",
          data: { authorization_url: "https://checkout.paystack.com/access_code_123" },
        }),
      } as Response;
    };

    const checkout = new PaystackCheckout("sk_test_paystack123", mockFetch);
    const res = await checkout.initialize({
      reference: "mlk_ref_001",
      amountNaira: "1500.50",
      riderRef: "rider_abc",
    });

    assert.strictEqual(capturedUrl, "https://api.paystack.co/transaction/initialize");
    assert.strictEqual(capturedBody.amount, 150050);
    assert.strictEqual(capturedBody.reference, "mlk_ref_001");
    assert.strictEqual(res.checkoutUrl, "https://checkout.paystack.com/access_code_123");
  });

  it("FlutterwaveCheckout initializes a payment transaction", async () => {
    let capturedUrl = "";
    let capturedBody: any = null;
    let capturedAuth = "";
    const mockFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedAuth = String((init?.headers as Record<string, string>)?.Authorization);
      capturedBody = JSON.parse(String(init?.body));
      return {
        ok: true,
        json: async () => ({
          status: "success",
          data: { link: "https://flutterwave.com/pay/tx_flw_123" },
        }),
      } as Response;
    };

    const checkout = new FlutterwaveCheckout("flw_sec_key_456", mockFetch);
    const res = await checkout.initialize({
      reference: "mlk_flw_001",
      amountNaira: "2500.00",
      riderRef: "rider_xyz",
    });

    assert.strictEqual(capturedUrl, "https://api.flutterwave.com/v3/payments");
    assert.strictEqual(capturedAuth, "Bearer flw_sec_key_456");
    assert.strictEqual(capturedBody.tx_ref, "mlk_flw_001");
    assert.strictEqual(capturedBody.amount, "2500.00");
    assert.strictEqual(capturedBody.currency, "NGN");
    assert.strictEqual(res.checkoutUrl, "https://flutterwave.com/pay/tx_flw_123");
  });
});
