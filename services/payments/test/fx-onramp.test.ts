import { describe, it } from "node:test";
import assert from "node:assert";
import { FixedRateProvider, OracleFxRateProvider } from "../src/fx.js";
import { PaymentProcessor, type OnrampProvider } from "../src/processor.js";
import { createTestDb, seedLease } from "../../../packages/shared/test-support/test-db.js";
import { MockLeaseChain } from "../../../packages/shared/test-support/mock-chain.js";

describe("OracleFxRateProvider", () => {
  it("fetches quote from oracle and caches it", async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ rate: "1620.500000" }),
      } as Response;
    };

    const provider = new OracleFxRateProvider({
      oracleUrl: "https://api.exchangerate.example/ngn",
      fetchFn: mockFetch,
      cacheTtlMs: 1000,
    });

    const quote1 = await provider.getQuote();
    assert.strictEqual(quote1.nairaPerToken, "1620.500000");
    assert.strictEqual(quote1.source, "oracle:api.exchangerate.example");
    assert.strictEqual(callCount, 1);

    // Immediate second call should use cache
    const quote2 = await provider.getQuote();
    assert.strictEqual(quote2.nairaPerToken, "1620.500000");
    assert.strictEqual(callCount, 1);
  });

  it("falls back to fallbackProvider when oracle endpoint fails", async () => {
    const mockFetch: typeof fetch = async () => {
      return { ok: false, status: 503 } as Response;
    };

    const fallback = new FixedRateProvider("1550.000000");
    const provider = new OracleFxRateProvider({
      oracleUrl: "https://api.exchangerate.example/down",
      fetchFn: mockFetch,
      fallbackProvider: fallback,
    });

    const quote = await provider.getQuote();
    assert.strictEqual(quote.nairaPerToken, "1550.000000");
    assert.strictEqual(quote.source, "fixed-dev:1550.000000");
  });
});

describe("PaymentProcessor Onramp Treasury Funding", () => {
  it("calls onramp.fundPayer before submitting chain payment", async () => {
    const { pool } = createTestDb();
    const { leaseId } = await seedLease(pool, { status: "Active" });
    const chain = new MockLeaseChain();
    chain.addLease({ id: leaseId, remainingBalance: "100000000" });

    let funded = false;
    let fundedAmount = 0n;
    const onramp: OnrampProvider = {
      async fundPayer(payer, token, amount) {
        funded = true;
        fundedAmount = amount;
        return { txHash: "treasury_tx_123" };
      },
    };

    const processor = new PaymentProcessor({
      db: pool,
      chain,
      onramp,
    });

    const paymentRes = await pool.query<{ id: string }>(
      `INSERT INTO payments (lease_id, payer_address, naira_amount, token_amount, fx_rate, fx_rate_source, provider, provider_reference, status)
       VALUES ($1, 'GBPAYERTEST', '15000', '10000000', '1500', 'fixed-dev', 'paystack', 'ref_onramp_1', 'pending')
       RETURNING id;`,
      [leaseId]
    );

    const result = await processor.process(paymentRes.rows[0].id);
    assert.strictEqual(result, "settled");
    assert.strictEqual(funded, true);
    assert.strictEqual(fundedAmount, 10000000n);
  });
});
