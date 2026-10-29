import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import Fastify from "fastify";
import { createTestDb, seedLease } from "../../../packages/shared/test-support/test-db.js";
import { MockLeaseChain } from "../../../packages/shared/test-support/mock-chain.js";
import {
  FixedRateProvider,
  InlineQueue,
  PaymentProcessor,
  paymentWebhookRoutes,
  reconcile,
  nairaToToken,
} from "../src/index.js";

const PAYSTACK_SECRET = "sk_test_unit_secret";
const FLW_HASH = "flw_unit_hash";
const sign = (body: string) => crypto.createHmac("sha512", PAYSTACK_SECRET).update(body).digest("hex");

const paystackBody = (reference: string, kobo: number) =>
  JSON.stringify({ event: "charge.success", data: { status: "success", reference, amount: kobo, currency: "NGN" } });

async function setup() {
  const { pool } = createTestDb();
  const { leaseId } = await seedLease(pool);
  const chain = new MockLeaseChain();
  chain.addLease({ id: leaseId, remainingBalance: "900000000" });
  const alerts: string[] = [];
  const processor = new PaymentProcessor({ db: pool, chain, alert: (m) => alerts.push(m), maxAttempts: 3 });
  const queue = new InlineQueue();
  queue.setHandler((id) => processor.process(id));
  const app = Fastify();
  await app.register(paymentWebhookRoutes, {
    db: pool,
    fx: new FixedRateProvider("1500.000000"),
    queue,
    paystackSecretKey: PAYSTACK_SECRET,
    flutterwaveSecretHash: FLW_HASH,
  });
  const intent = (reference: string, provider = "paystack") =>
    pool.query(
      `INSERT INTO payment_intents (reference, lease_id, payer_address, provider, naira_amount) VALUES ($1, $2, 'GPAYER', $3, 1000);`,
      [reference, leaseId, provider]
    );
  const post = (body: string, headers: Record<string, string>, provider = "paystack") =>
    app.inject({ method: "POST", url: `/v1/webhooks/${provider}`, payload: body, headers: { "content-type": "application/json", ...headers } });
  return { pool, chain, processor, app, intent, post, leaseId, alerts };
}

describe("nairaToToken", () => {
  it("converts naira to 7-decimal token base units, rounding down", () => {
    // 15,000 NGN at 1500 NGN/USD = 10 USD = 100,000,000 base units
    assert.strictEqual(nairaToToken("15000.00", "1500.000000"), 100_000_000n);
    assert.strictEqual(nairaToToken("0.01", "1500.000000"), 66n);
  });
});

describe("payments webhooks", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });

  it("accepts a valid Paystack signature, records FX, and settles on-chain", async () => {
    await s.intent("ref_ok");
    const body = paystackBody("ref_ok", 1500000); // 15,000 NGN
    const res = await s.post(body, { "x-paystack-signature": sign(body) });
    assert.strictEqual(res.statusCode, 200);
    const p = (await s.pool.query(`SELECT * FROM payments WHERE provider_reference = 'ref_ok';`)).rows[0];
    assert.strictEqual(p.status, "confirmed");
    assert.strictEqual(String(p.token_amount), "100000000");
    assert.ok(String(p.fx_rate_source).startsWith("fixed-dev"));
    assert.ok(p.tx_hash);
    assert.deepStrictEqual(s.chain.applied.map((a) => a.amount), [100_000_000n]);
  });

  it("rejects an invalid signature and does nothing", async () => {
    await s.intent("ref_bad");
    const body = paystackBody("ref_bad", 1500000);
    const res = await s.post(body, { "x-paystack-signature": "deadbeef" });
    assert.strictEqual(res.statusCode, 401);
    const rows = (await s.pool.query(`SELECT * FROM payments;`)).rows;
    assert.strictEqual(rows.length, 0);
    assert.strictEqual(s.chain.applied.length, 0);
  });

  it("rejects a body that was tampered with after signing", async () => {
    await s.intent("ref_t");
    const body = paystackBody("ref_t", 1500000);
    const res = await s.post(paystackBody("ref_t", 99999999), { "x-paystack-signature": sign(body) });
    assert.strictEqual(res.statusCode, 401);
  });

  it("a replayed webhook is a no-op (no second row, no second on-chain payment)", async () => {
    await s.intent("ref_replay");
    const body = paystackBody("ref_replay", 1500000);
    const headers = { "x-paystack-signature": sign(body) };
    assert.strictEqual((await s.post(body, headers)).statusCode, 200);
    const second = await s.post(body, headers);
    assert.strictEqual(second.statusCode, 200);
    assert.strictEqual(second.json().status, "duplicate");
    assert.strictEqual((await s.pool.query(`SELECT * FROM payments;`)).rows.length, 1);
    assert.strictEqual(s.chain.applied.length, 1);
  });

  it("ignores references we never issued and leaves an audit trail", async () => {
    const body = paystackBody("ref_unknown", 1500000);
    const res = await s.post(body, { "x-paystack-signature": sign(body) });
    assert.strictEqual(res.json().status, "ignored");
    assert.strictEqual((await s.pool.query(`SELECT * FROM payments;`)).rows.length, 0);
    const audit = (await s.pool.query(`SELECT * FROM audit_log WHERE action = 'unknown_payment_reference';`)).rows;
    assert.strictEqual(audit.length, 1);
  });

  it("verifies Flutterwave verif-hash", async () => {
    await s.intent("flw_ref", "flutterwave");
    const body = JSON.stringify({ event: "charge.completed", data: { status: "successful", tx_ref: "flw_ref", amount: 15000, currency: "NGN" } });
    const bad = await s.post(body, { "verif-hash": "wrong" }, "flutterwave");
    assert.strictEqual(bad.statusCode, 401);
    const ok = await s.post(body, { "verif-hash": FLW_HASH }, "flutterwave");
    assert.strictEqual(ok.statusCode, 200);
    const p = (await s.pool.query(`SELECT * FROM payments WHERE provider_reference = 'flw_ref';`)).rows[0];
    assert.strictEqual(p.status, "confirmed");
    assert.strictEqual(p.provider, "flutterwave");
  });

  it("a Flutterwave webhook cannot settle a Paystack intent", async () => {
    await s.intent("cross_ref", "paystack");
    const body = JSON.stringify({ event: "charge.completed", data: { status: "successful", tx_ref: "cross_ref", amount: 15000, currency: "NGN" } });
    const res = await s.post(body, { "verif-hash": FLW_HASH }, "flutterwave");
    assert.strictEqual(res.json().status, "ignored");
    assert.strictEqual((await s.pool.query(`SELECT * FROM payments;`)).rows.length, 0);
  });

  it("recorded Paystack fixture drives a payment end to end", async () => {
    await s.intent("mlk_fixture_0001");
    const body = fs.readFileSync(new URL("./fixtures/paystack-charge-success.json", import.meta.url), "utf-8");
    const res = await s.post(body, { "x-paystack-signature": sign(body) });
    assert.strictEqual(res.statusCode, 200);
    const p = (await s.pool.query(`SELECT * FROM payments WHERE provider_reference = 'mlk_fixture_0001';`)).rows[0];
    assert.strictEqual(p.status, "confirmed");
    assert.strictEqual(s.chain.applied.length, 1);
  });
});

describe("retry safety", () => {
  it("timeout after the tx landed: retry settles WITHOUT paying twice", async () => {
    const s = await setup();
    s.chain.failAfterLanding = 1;
    await s.intent("ref_timeout");
    const body = paystackBody("ref_timeout", 1500000);
    await s.post(body, { "x-paystack-signature": sign(body) });

    let p = (await s.pool.query(`SELECT * FROM payments;`)).rows[0];
    assert.strictEqual(p.status, "failed"); // not settled: we did not see finality
    assert.strictEqual(s.chain.applied.length, 1); // but it did land

    await s.processor.retryDue(0);
    p = (await s.pool.query(`SELECT * FROM payments;`)).rows[0];
    assert.strictEqual(p.status, "confirmed");
    assert.strictEqual(s.chain.applied.length, 1, "must not pay a second time");
    assert.strictEqual(s.chain.prepareCalls, 1, "must not even build a second transaction");
  });

  it("failure before landing: retry re-sends the SAME signed tx and pays once", async () => {
    const s = await setup();
    s.chain.failBeforeLanding = 2;
    await s.intent("ref_fail");
    const body = paystackBody("ref_fail", 1500000);
    await s.post(body, { "x-paystack-signature": sign(body) });
    assert.strictEqual((await s.pool.query(`SELECT * FROM payments;`)).rows[0].status, "failed");
    assert.strictEqual(s.chain.applied.length, 0);

    await s.processor.retryDue(0); // fails again
    await s.processor.retryDue(0); // succeeds
    const p = (await s.pool.query(`SELECT * FROM payments;`)).rows[0];
    assert.strictEqual(p.status, "confirmed");
    assert.strictEqual(s.chain.applied.length, 1);
    assert.strictEqual(s.chain.prepareCalls, 1);
  });

  it("an RPC outage never loses the payment; it stays retryable and then alerts for review", async () => {
    const s = await setup();
    s.chain.rpcDown = true;
    await s.intent("ref_rpc");
    const body = paystackBody("ref_rpc", 1500000);
    await s.post(body, { "x-paystack-signature": sign(body) });
    for (let i = 0; i < 3; i++) await s.processor.retryDue(0);
    const p = (await s.pool.query(`SELECT * FROM payments;`)).rows[0];
    assert.notStrictEqual(p.status, "confirmed");
    assert.strictEqual(p.needs_review, true);
    assert.ok(s.alerts.some((a) => a.includes("manual review")));
    assert.strictEqual(s.chain.applied.length, 0);
  });

  it("concurrent processing of the same payment applies it once", async () => {
    const s = await setup();
    await s.intent("ref_conc");
    const body = paystackBody("ref_conc", 1500000);
    await s.post(body, { "x-paystack-signature": sign(body) });
    const id = (await s.pool.query(`SELECT id FROM payments;`)).rows[0].id;
    await Promise.all([s.processor.process(id), s.processor.process(id)]);
    assert.strictEqual(s.chain.applied.length, 1);
  });
});

describe("overpayment", () => {
  it("applies only the remaining balance on-chain and flags the excess for manual refund", async () => {
    const s = await setup();
    s.chain.addLease({ id: s.leaseId, remainingBalance: "30000000" }); // 3 USD left
    await s.intent("ref_over");
    const body = paystackBody("ref_over", 1500000); // 15,000 NGN = 10 USD
    await s.post(body, { "x-paystack-signature": sign(body) });
    const p = (await s.pool.query(`SELECT * FROM payments;`)).rows[0];
    assert.strictEqual(p.status, "confirmed");
    assert.strictEqual(String(p.applied_token_amount), "30000000");
    assert.strictEqual(String(p.excess_token_amount), "70000000");
    assert.strictEqual(p.refund_flagged, true);
    assert.strictEqual(Number(p.excess_naira_amount), 10500);
    assert.deepStrictEqual(s.chain.applied.map((a) => a.amount), [30_000_000n]);
    const audit = (await s.pool.query(`SELECT * FROM audit_log WHERE action = 'overpayment_excess_flagged';`)).rows;
    assert.strictEqual(audit.length, 1);
    assert.ok(s.alerts.some((a) => a.includes("Overpayment")));
  });

  it("a payment on an already paid-off lease sends nothing on-chain and flags it all", async () => {
    const s = await setup();
    s.chain.addLease({ id: s.leaseId, remainingBalance: "0", derivedStatus: "Completed", storedStatus: "Completed" });
    await s.intent("ref_done");
    const body = paystackBody("ref_done", 1500000);
    await s.post(body, { "x-paystack-signature": sign(body) });
    const p = (await s.pool.query(`SELECT * FROM payments;`)).rows[0];
    assert.strictEqual(p.status, "confirmed");
    assert.strictEqual(String(p.excess_token_amount), "100000000");
    assert.strictEqual(s.chain.prepareCalls, 0);
  });
});

describe("daily reconciliation", () => {
  it("detects a settled payment with no matching on-chain payment event", async () => {
    const s = await setup();
    await s.intent("ref_rec");
    const body = paystackBody("ref_rec", 1500000);
    await s.post(body, { "x-paystack-signature": sign(body) });
    const alerts: string[] = [];
    const mismatches = await reconcile({ db: s.pool, alert: (m) => alerts.push(m) });
    assert.strictEqual(mismatches.length, 1);
    assert.strictEqual(mismatches[0].kind, "missing_on_chain");
    assert.strictEqual(alerts.length, 1);
    const audit = (await s.pool.query(`SELECT * FROM audit_log WHERE action = 'reconciliation_mismatch';`)).rows;
    assert.strictEqual(audit.length, 1);
  });

  it("reports nothing when the indexer saw the on-chain payment", async () => {
    const s = await setup();
    await s.intent("ref_rec2");
    const body = paystackBody("ref_rec2", 1500000);
    await s.post(body, { "x-paystack-signature": sign(body) });
    const p = (await s.pool.query(`SELECT * FROM payments;`)).rows[0];
    await s.pool.query(
      `INSERT INTO chain_events (contract_id, event_name, tx_hash, event_index, ledger_sequence, ledger_closed_at, topics, data)
       VALUES ('C1', 'payment', $1, 0, 10, NOW(), '[]', $2);`,
      [p.tx_hash, JSON.stringify(["100000000", "100000000", "5"])]
    );
    assert.deepStrictEqual(await reconcile({ db: s.pool }), []);
  });

  it("flags an amount mismatch and a payment stuck unsettled", async () => {
    const s = await setup();
    await s.intent("ref_a");
    const body = paystackBody("ref_a", 1500000);
    await s.post(body, { "x-paystack-signature": sign(body) });
    const p = (await s.pool.query(`SELECT * FROM payments;`)).rows[0];
    await s.pool.query(
      `INSERT INTO chain_events (contract_id, event_name, tx_hash, event_index, ledger_sequence, ledger_closed_at, topics, data)
       VALUES ('C1', 'payment', $1, 0, 10, NOW(), '[]', $2);`,
      [p.tx_hash, JSON.stringify(["5", "5", "5"])]
    );
    assert.strictEqual((await reconcile({ db: s.pool }))[0].kind, "amount_mismatch");

    await s.pool.query(
      `INSERT INTO payments (lease_id, payer_address, naira_amount, token_amount, fx_rate, provider, provider_reference, status)
       VALUES ($1, 'GPAYER', 100, 1, 1500, 'paystack', 'stuck_ref', 'pending');`,
      [s.leaseId]
    );
    const later = await reconcile({ db: s.pool, now: () => new Date(Date.now() + 2 * 3600 * 1000) });
    assert.ok(later.some((m) => m.kind === "stuck_unsettled"));
  });
});
