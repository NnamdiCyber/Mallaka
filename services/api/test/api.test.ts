import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { generateOpenApi, OPENAPI_PATH } from "../src/generate-openapi.js";
import { setup, paystackSign, RIDER_PHONE, RIDER_ADDR } from "./helpers.js";

describe("auth", () => {
  it("rider logs in with a dev OTP and views a lease", async () => {
    const s = await setup();
    await s.addLease(1, "Active");
    const req = await s.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: RIDER_PHONE } });
    assert.strictEqual(req.statusCode, 202);
    assert.match(s.driver.sent[0].text, /your code is \d{6}/); // console driver
    const ver = await s.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone: RIDER_PHONE, code: s.codes[0] } });
    assert.strictEqual(ver.statusCode, 200);
    assert.strictEqual(ver.json().role, "rider");
    const list = await s.app.inject({ method: "GET", url: "/v1/leases", headers: s.auth(ver.json().token) });
    assert.strictEqual(list.json().leases.length, 1);
  });

  it("rejects wrong, reused and expired codes; unknown numbers get the same answer", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const s = await setup({ now: () => now });
    await s.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: RIDER_PHONE } });
    const bad = await s.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone: RIDER_PHONE, code: "000000" } });
    assert.strictEqual(bad.statusCode, 401);
    const ok = await s.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone: RIDER_PHONE, code: s.codes[0] } });
    assert.strictEqual(ok.statusCode, 200);
    const reuse = await s.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone: RIDER_PHONE, code: s.codes[0] } });
    assert.strictEqual(reuse.statusCode, 401);

    await s.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: RIDER_PHONE } });
    now = new Date(now.getTime() + 11 * 60 * 1000);
    const late = await s.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone: RIDER_PHONE, code: s.codes[1] } });
    assert.strictEqual(late.statusCode, 401);

    const unknown = await s.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: "+2349999999999" } });
    assert.strictEqual(unknown.statusCode, 202);
    assert.strictEqual(s.codes.length, 2); // nothing sent
  });

  it("locks the code after too many wrong attempts", async () => {
    const s = await setup();
    await s.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: RIDER_PHONE } });
    for (let i = 0; i < 5; i++) await s.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone: RIDER_PHONE, code: "111111" } });
    const r = await s.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone: RIDER_PHONE, code: s.codes[0] } });
    assert.strictEqual(r.statusCode, 401);
  });
});

describe("role checks and privacy", () => {
  it("requires a token and the right role on every route", async () => {
    const s = await setup();
    await s.addLease(1, "Active");
    assert.strictEqual((await s.app.inject({ method: "GET", url: "/v1/leases" })).statusCode, 401);
    assert.strictEqual((await s.app.inject({ method: "GET", url: "/v1/leases", headers: { authorization: "Bearer junk" } })).statusCode, 401);
    const create = await s.app.inject({ method: "POST", url: "/v1/leases", headers: s.auth(s.riderToken), payload: {} });
    assert.strictEqual(create.statusCode, 403);
    for (const url of ["/v1/admin/audit-log"]) {
      assert.strictEqual((await s.app.inject({ method: "GET", url, headers: s.auth(s.riderToken) })).statusCode, 403);
    }
    for (const act of ["lock", "unlock"]) {
      const r = await s.app.inject({ method: "POST", url: `/v1/admin/leases/1/${act}`, headers: s.auth(s.riderToken), payload: { reason: "long enough reason" } });
      assert.strictEqual(r.statusCode, 403);
    }
    assert.strictEqual((await s.app.inject({ method: "POST", url: "/v1/leases/1/activate", headers: s.auth(s.staffToken) })).statusCode, 403);
    assert.strictEqual((await s.app.inject({ method: "POST", url: "/v1/leases/1/payments/initiate", headers: s.auth(s.staffToken), payload: { amountNaira: "500" } })).statusCode, 403);
  });

  it("other riders' leases look like they do not exist", async () => {
    const s = await setup();
    await s.addLease(1, "Active");
    const other = s.app.jwt.sign({ id: "00000000-0000-0000-0000-000000000099", role: "rider" });
    assert.strictEqual((await s.app.inject({ method: "GET", url: "/v1/leases/1", headers: s.auth(other) })).statusCode, 404);
  });

  it("returns no PII to riders, only a masked phone to staff, and no tx hash to riders", async () => {
    const s = await setup();
    await s.addLease(1, "Active");
    const rider = (await s.app.inject({ method: "GET", url: "/v1/leases/1", headers: s.auth(s.riderToken) })).json();
    assert.strictEqual(rider.lessee, undefined);
    assert.strictEqual(rider.asset.deviceId, undefined);
    const staff = (await s.app.inject({ method: "GET", url: "/v1/leases/1", headers: s.auth(s.staffToken) })).json();
    assert.strictEqual(staff.lessee.phoneLast4, RIDER_PHONE.slice(-4));
    assert.ok(!JSON.stringify(staff).includes(RIDER_PHONE));
    assert.strictEqual(staff.asset.deviceId, "DEV-1");
  });
});

describe("validation and errors", () => {
  it("rejects malformed bodies with the consistent error format", async () => {
    const s = await setup();
    const r = await s.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: "0803" } });
    assert.strictEqual(r.statusCode, 400);
    assert.strictEqual(r.json().error.code, "VALIDATION_ERROR");
    const extra = await s.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: RIDER_PHONE, admin: true } });
    assert.strictEqual(extra.statusCode, 400);
    await s.addLease(1, "Active");
    const bad = await s.app.inject({ method: "POST", url: "/v1/leases/1/payments/initiate", headers: s.auth(s.riderToken), payload: { amountNaira: "-5" } });
    assert.strictEqual(bad.statusCode, 400);
    const badId = await s.app.inject({ method: "GET", url: "/v1/leases/abc", headers: s.auth(s.riderToken) });
    assert.strictEqual(badId.statusCode, 400);
  });

  it("surfaces chain errors by their README 7.5 name", async () => {
    const s = await setup();
    await s.addLease(1, "Pending");
    s.chain.submit = async () => { const { ContractError } = await import("@mallaka/shared"); throw ContractError.fromCode(6); };
    const r = await s.app.inject({ method: "POST", url: "/v1/leases/1/activate", headers: s.auth(s.riderToken) });
    assert.strictEqual(r.statusCode, 409);
    assert.strictEqual(r.json().error.code, "AlreadyActive");
    assert.strictEqual(r.json().error.contractError, "AlreadyActive");
  });

  it("rate limits the OTP endpoint", async () => {
    const s = await setup();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await s.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: RIDER_PHONE } })).statusCode);
    assert.deepStrictEqual(codes.slice(0, 5), [202, 202, 202, 202, 202]);
    assert.strictEqual(codes[6], 429);
  });

  it("applies the global rate limit to other routes", async () => {
    const s = await setup({ rateLimit: { max: 3, timeWindow: "1 minute" } });
    const out: number[] = [];
    for (let i = 0; i < 5; i++) out.push((await s.app.inject({ method: "GET", url: "/v1/leases" })).statusCode);
    assert.ok(out.includes(429));
    assert.strictEqual((await s.app.inject({ method: "GET", url: "/v1/leases" })).json().error.code, "RATE_LIMITED");
  });
});

describe("lease flows against a mocked chain", () => {
  it("lessor creates a lease through the sponsor path; no keys or XLM from the user", async () => {
    const s = await setup();
    const body = {
      asset: { vinOrSerial: "VIN-NEW-001", assetType: "motorcycle", deviceId: "DEV-9", photoRefs: ["photos/a.jpg"] },
      lessee: { phone: "+2348111111111", address: RIDER_ADDR },
      totalPrice: "1000", deposit: "100", installment: "10", interval: "daily", graceDays: 2, repossessionWaitDays: 3,
    };
    const r = await s.app.inject({ method: "POST", url: "/v1/leases", headers: s.auth(s.staffToken), payload: body });
    assert.strictEqual(r.statusCode, 201);
    assert.strictEqual(r.json().status, "Pending");
    assert.strictEqual(r.json().terms.totalPrice.token, "1000.00");
    assert.strictEqual(r.json().terms.totalPrice.naira, "1500000.00");
    assert.ok([...s.chain.landed.values()].some((o) => o.kind === "create_lease"));
    assert.ok(!JSON.stringify(r.json()).includes("+2348111111111"));
    const audit = await s.pool.query(`SELECT * FROM audit_log WHERE action = 'lease_created';`);
    assert.strictEqual(audit.rows.length, 1);

    const invalid = await s.app.inject({ method: "POST", url: "/v1/leases", headers: s.auth(s.staffToken), payload: { ...body, asset: { ...body.asset, vinOrSerial: "VIN-X2" }, deposit: "2000" } });
    assert.strictEqual(invalid.statusCode, 400);
    assert.strictEqual(invalid.json().error.code, "InvalidTerms");
  });

  it("rider activates a pending lease", async () => {
    const s = await setup();
    await s.addLease(1, "Pending");
    s.chain.leases.get("1")!.derivedStatus = "Pending";
    const r = await s.app.inject({ method: "POST", url: "/v1/leases/1/activate", headers: s.auth(s.riderToken) });
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.json().status, "Active");
    assert.ok([...s.chain.landed.values()].some((o) => o.kind === "activate" && o.lessee === RIDER_ADDR));
    const again = await s.app.inject({ method: "POST", url: "/v1/leases/1/activate", headers: s.auth(s.riderToken) });
    assert.strictEqual(again.json().error.code, "AlreadyActive");
  });

  it("pay flow: initiate, provider webhook, settled history and receipt", async () => {
    const s = await setup();
    await s.addLease(1, "Active");
    const init = await s.app.inject({ method: "POST", url: "/v1/leases/1/payments/initiate", headers: s.auth(s.riderToken), payload: { amountNaira: "15000" } });
    assert.strictEqual(init.statusCode, 201);
    const { reference } = init.json();

    const body = JSON.stringify({ event: "charge.success", data: { status: "success", reference, amount: 1500000, currency: "NGN" } });
    const bad = await s.app.inject({ method: "POST", url: "/v1/webhooks/paystack", payload: body, headers: { "content-type": "application/json", "x-paystack-signature": "nope" } });
    assert.strictEqual(bad.statusCode, 401);
    const hook = await s.app.inject({ method: "POST", url: "/v1/webhooks/paystack", payload: body, headers: { "content-type": "application/json", "x-paystack-signature": paystackSign(body) } });
    assert.strictEqual(hook.statusCode, 200);
    assert.strictEqual(s.chain.applied.length, 1);

    const hist = (await s.app.inject({ method: "GET", url: "/v1/leases/1/payments", headers: s.auth(s.riderToken) })).json();
    assert.strictEqual(hist.payments[0].status, "settled");
    assert.strictEqual(hist.payments[0].txHash, undefined);
    const staffHist = (await s.app.inject({ method: "GET", url: "/v1/leases/1/payments", headers: s.auth(s.staffToken) })).json();
    assert.ok(staffHist.payments[0].txHash);

    const rc = await s.app.inject({ method: "GET", url: `/v1/leases/1/receipt/${hist.payments[0].id}`, headers: s.auth(s.riderToken) });
    assert.strictEqual(rc.statusCode, 200);
    const receipt = rc.json();
    assert.strictEqual(receipt.nairaAmount, "15000.00");
    assert.strictEqual(receipt.balanceRemaining.naira, "120000.00");
    assert.strictEqual(receipt.txHash, undefined);
    const text = JSON.stringify(receipt);
    assert.ok(!text.includes(RIDER_PHONE) && !text.includes(RIDER_ADDR));
  });

  it("a receipt is refused until the payment is settled; an unknown provider is a clear 501", async () => {
    const s = await setup();
    await s.addLease(1, "Active");
    await s.pool.query(`INSERT INTO payments (id, lease_id, payer_address, naira_amount, token_amount, fx_rate, provider, provider_reference, status) VALUES ('11111111-1111-1111-1111-111111111111',1,'G',100,1,1500,'paystack','r1','pending');`);
    const r = await s.app.inject({ method: "GET", url: "/v1/leases/1/receipt/11111111-1111-1111-1111-111111111111", headers: s.auth(s.riderToken) });
    assert.strictEqual(r.statusCode, 409);
    const fw = await s.app.inject({ method: "POST", url: "/v1/leases/1/payments/initiate", headers: s.auth(s.riderToken), payload: { amountNaira: "500", provider: "flutterwave" } });
    assert.strictEqual(fw.statusCode, 501);
  });

  it("serves the cache, falls back to the chain when stale or on request, and flags stale when the chain is down", async () => {
    const s = await setup();
    await s.addLease(1, "Active");
    s.chain.leases.get("1")!.derivedStatus = "Grace";
    const cached = (await s.app.inject({ method: "GET", url: "/v1/leases/1", headers: s.auth(s.riderToken) })).json();
    assert.strictEqual(cached.source, "cache");
    assert.strictEqual(cached.status, "Active");
    const fresh = (await s.app.inject({ method: "GET", url: "/v1/leases/1?fresh=true", headers: s.auth(s.riderToken) })).json();
    assert.strictEqual(fresh.source, "chain");
    assert.strictEqual(fresh.status, "Grace");
    s.chain.rpcDown = true;
    const down = (await s.app.inject({ method: "GET", url: "/v1/leases/1?fresh=true", headers: s.auth(s.riderToken) })).json();
    assert.strictEqual(down.source, "cache");
    assert.strictEqual(down.stale, true);
    // old cache => chain read without asking
    s.chain.rpcDown = false;
    await s.pool.query(`UPDATE leases SET updated_at = '2020-01-01T00:00:00Z';`);
    s.chain.leases.get("1")!.derivedStatus = "Defaulted";
    const stale = (await s.app.inject({ method: "GET", url: "/v1/leases/1", headers: s.auth(s.riderToken) })).json();
    assert.strictEqual(stale.source, "chain");
    assert.strictEqual(stale.status, "Defaulted");
  });
});

describe("admin lock/unlock, two-person approval and audit log", () => {
  const reason = "Rider unreachable for two weeks";

  it("below the threshold a single staff member can queue a lock; command and audit are written", async () => {
    const s = await setup({ threshold: 10_000_000_000n });
    await s.addLease(1, "Defaulted");
    const r = await s.app.inject({ method: "POST", url: "/v1/admin/leases/1/lock", headers: s.auth(s.staffToken), payload: { reason } });
    assert.strictEqual(r.statusCode, 202);
    assert.strictEqual(r.json().status, "queued");
    const cmd = (await s.pool.query(`SELECT * FROM lock_commands;`)).rows;
    assert.strictEqual(cmd.length, 1);
    assert.strictEqual(cmd[0].command, "lock");
    assert.strictEqual(cmd[0].status, "queued");
    assert.match(cmd[0].triggered_by, /^lessor_staff:/);
    const audit = (await s.pool.query(`SELECT * FROM audit_log WHERE action = 'lock_requested';`)).rows;
    assert.strictEqual(audit.length, 1);
  });

  it("above the threshold: second approver required, never the requester, single use", async () => {
    const s = await setup({ threshold: 1000n });
    await s.addLease(1, "Defaulted");
    const first = await s.app.inject({ method: "POST", url: "/v1/admin/leases/1/lock", headers: s.auth(s.staffToken), payload: { reason } });
    assert.strictEqual(first.json().status, "approval_required");
    assert.strictEqual((await s.pool.query(`SELECT * FROM lock_commands;`)).rows.length, 0);
    const approvalId = first.json().approvalId;

    const self = await s.app.inject({ method: "POST", url: "/v1/admin/leases/1/lock", headers: s.auth(s.staffToken), payload: { reason, approvalId } });
    assert.strictEqual(self.statusCode, 403);
    assert.strictEqual((await s.pool.query(`SELECT * FROM lock_commands;`)).rows.length, 0);

    const second = await s.app.inject({ method: "POST", url: "/v1/admin/leases/1/lock", headers: s.auth(s.staff2Token), payload: { reason, approvalId } });
    assert.strictEqual(second.statusCode, 202);
    assert.strictEqual(second.json().status, "queued");
    const cmd = (await s.pool.query(`SELECT * FROM lock_commands;`)).rows;
    assert.strictEqual(cmd.length, 1);
    assert.match(cmd[0].two_person_approved_by, /^lessor_staff:/);
    assert.notStrictEqual(cmd[0].two_person_approved_by, cmd[0].triggered_by);

    const reuse = await s.app.inject({ method: "POST", url: "/v1/admin/leases/1/lock", headers: s.auth(s.adminToken), payload: { reason, approvalId } });
    assert.strictEqual(reuse.statusCode, 409);

    const actions = (await s.pool.query(`SELECT action FROM audit_log ORDER BY created_at;`)).rows.map((r) => r.action);
    assert.deepStrictEqual(actions, ["lock_approval_requested", "lock_approved"]);
  });

  it("refuses to lock when the chain says the lease is not Defaulted, and fails open if the chain is down", async () => {
    const s = await setup({ threshold: 10_000_000_000n });
    await s.addLease(1, "Active");
    const notDefaulted = await s.app.inject({ method: "POST", url: "/v1/admin/leases/1/lock", headers: s.auth(s.staffToken), payload: { reason } });
    assert.strictEqual(notDefaulted.statusCode, 409);
    assert.strictEqual(notDefaulted.json().error.code, "NotDefaulted");
    s.chain.rpcDown = true;
    const down = await s.app.inject({ method: "POST", url: "/v1/admin/leases/1/lock", headers: s.auth(s.staffToken), payload: { reason } });
    assert.strictEqual(down.statusCode, 503);
    assert.strictEqual((await s.pool.query(`SELECT * FROM lock_commands;`)).rows.length, 0);
  });

  it("requires a real reason", async () => {
    const s = await setup();
    await s.addLease(1, "Defaulted");
    const r = await s.app.inject({ method: "POST", url: "/v1/admin/leases/1/lock", headers: s.auth(s.staffToken), payload: { reason: "no" } });
    assert.strictEqual(r.statusCode, 400);
  });

  it("unlock needs no second approver and is logged", async () => {
    const s = await setup({ threshold: 1n });
    await s.addLease(1, "Defaulted");
    const r = await s.app.inject({ method: "POST", url: "/v1/admin/leases/1/unlock", headers: s.auth(s.staffToken), payload: { reason: "Rider paid in cash today" } });
    assert.strictEqual(r.statusCode, 202);
    assert.strictEqual((await s.pool.query(`SELECT * FROM lock_commands WHERE command = 'unlock';`)).rows.length, 1);
    assert.strictEqual((await s.pool.query(`SELECT * FROM audit_log WHERE action = 'unlock_requested';`)).rows.length, 1);
  });

  it("audit log: admin sees all (with IP), staff see only their lessor's leases", async () => {
    const s = await setup({ threshold: 10_000_000_000n });
    await s.addLease(1, "Defaulted");
    await s.app.inject({ method: "POST", url: "/v1/admin/leases/1/lock", headers: s.auth(s.staffToken), payload: { reason } });
    await s.pool.query(`INSERT INTO audit_log (actor, action, resource, details) VALUES ('system', 'other', 'lease:999', '{}');`);
    const admin = (await s.app.inject({ method: "GET", url: "/v1/admin/audit-log", headers: s.auth(s.adminToken) })).json();
    assert.strictEqual(admin.entries.length, 2);
    assert.ok("ipAddress" in admin.entries[0]);
    const staff = (await s.app.inject({ method: "GET", url: "/v1/admin/audit-log", headers: s.auth(s.staffToken) })).json();
    assert.strictEqual(staff.entries.length, 1);
    assert.strictEqual(staff.entries[0].action, "lock_requested");
    assert.ok(!("ipAddress" in staff.entries[0]));
  });

  it("staff cannot act on another lessor's lease", async () => {
    const s = await setup();
    await s.addLease(1, "Defaulted");
    const other = s.app.jwt.sign({ id: s.staffId, role: "lessor_staff", lessorId: "00000000-0000-0000-0000-000000000077" });
    const r = await s.app.inject({ method: "POST", url: "/v1/admin/leases/1/unlock", headers: s.auth(other), payload: { reason } });
    assert.strictEqual(r.statusCode, 404);
  });
});

describe("OpenAPI", () => {
  it("documents exactly the README section 9 endpoints and docs/openapi.json is up to date", async () => {
    const generated = await generateOpenApi();
    const paths = Object.keys(JSON.parse(generated).paths).sort();
    assert.deepStrictEqual(paths, [
      "/v1/admin/audit-log",
      "/v1/admin/leases/{id}/lock",
      "/v1/admin/leases/{id}/unlock",
      "/v1/auth/otp/request",
      "/v1/auth/otp/verify",
      "/v1/leases",
      "/v1/leases/{id}",
      "/v1/leases/{id}/activate",
      "/v1/leases/{id}/payments",
      "/v1/leases/{id}/payments/initiate",
      "/v1/leases/{id}/receipt/{paymentId}",
      "/v1/webhooks/flutterwave",
      "/v1/webhooks/paystack",
    ]);
    assert.ok(fs.existsSync(OPENAPI_PATH), "run `pnpm --filter @mallaka/api openapi` and commit docs/openapi.json");
    assert.strictEqual(fs.readFileSync(OPENAPI_PATH, "utf-8"), generated, "docs/openapi.json is stale; regenerate it");
  });
});
