import { describe, it } from "node:test";
import assert from "node:assert";
import { encryptContactInfo } from "@mallaka/shared";
import { ConsoleDriver, Notifier } from "@mallaka/notifier";
import { createTestDb, seedLease } from "../../../packages/shared/test-support/test-db.js";
import { MockLeaseChain } from "../../../packages/shared/test-support/mock-chain.js";
import { LockBridge, ManualDriver, MockDevice, VendorHttpDriver } from "../src/index.js";

const SECRET = "lock_bridge_test_secret_phrase_01";
const T0 = new Date("2026-11-01T10:00:00Z");

async function setup(opts: { notices?: ("grace_entered" | "pre_lock")[]; status?: "Defaulted" | "Active" } = {}) {
  const { pool } = createTestDb();
  const { leaseId } = await seedLease(pool, { status: "Defaulted" });
  const user = await pool.query(`INSERT INTO users (role, contact_info_encrypted) VALUES ('rider', $1) RETURNING id;`, [
    encryptContactInfo({ phone: "+2348023456789" }, SECRET),
  ]);
  await pool.query(`UPDATE leases SET lessee_id = $1;`, [user.rows[0].id]);
  const chain = new MockLeaseChain();
  chain.addLease({ id: leaseId, derivedStatus: opts.status ?? "Defaulted", storedStatus: opts.status ?? "Defaulted", arrears: "100000000" });
  const device = new MockDevice();
  const sms = new ConsoleDriver();
  const notifier = new Notifier({ driver: sms, db: pool, contactSecret: SECRET });
  const clock = { now: new Date(T0) };
  const bridge = new LockBridge({
    db: pool, chain, device, notifier,
    preLockDelaySeconds: 3600, retryDelaySeconds: 60, now: () => clock.now,
  });
  // Notices recorded 2 hours before T0 unless the test says otherwise.
  for (const kind of opts.notices ?? []) {
    await pool.query(`INSERT INTO rider_notices (lease_id, kind, channel, created_at) VALUES ($1, $2, 'console', $3);`, [
      leaseId, kind, new Date(T0.getTime() - 2 * 3600 * 1000).toISOString(),
    ]);
  }
  const commands = async () => (await pool.query(`SELECT * FROM lock_commands ORDER BY created_at;`)).rows;
  const advance = (seconds: number) => { clock.now = new Date(clock.now.getTime() + seconds * 1000); };
  return { pool, leaseId, chain, device, sms, bridge, commands, advance, clock };
}

const det = (v: unknown): Record<string, unknown> => (typeof v === "string" ? JSON.parse(v) : (v as Record<string, unknown>));
const defaulted = (leaseId: string) => ({ eventName: "defaulted", leaseId, txHash: "tx1" });

describe("lock bridge safety rules", () => {
  it("refuses to lock when the chain says the lease is Active (does not trust the event)", async () => {
    const s = await setup({ status: "Active", notices: ["grace_entered", "pre_lock"] });
    assert.strictEqual(await s.bridge.handleJob(defaulted(s.leaseId)), "refused");
    assert.strictEqual(s.device.sent.length, 0);
    const [cmd] = await s.commands();
    assert.strictEqual(cmd.status, "failed");
    assert.strictEqual(det(cmd.result_details).reason, "chain_state_not_defaulted");
  });

  it("FAILS OPEN: an RPC error means no lock, and the command is retried later", async () => {
    const s = await setup({ notices: ["grace_entered", "pre_lock"] });
    s.chain.rpcDown = true;
    assert.strictEqual(await s.bridge.handleJob(defaulted(s.leaseId)), "fail_open");
    assert.strictEqual(s.device.sent.length, 0);
    const [cmd] = await s.commands();
    assert.strictEqual(cmd.status, "queued");
    assert.strictEqual(det(cmd.result_details).failOpen, true);
    // chain recovers: the sweeper re-reads and now locks
    s.chain.rpcDown = false;
    s.advance(120);
    await s.bridge.processQueued();
    assert.strictEqual(s.device.sent.length, 1);
  });

  it("defers the lock while the vehicle is moving, then locks at the next stop", async () => {
    const s = await setup({ notices: ["grace_entered", "pre_lock"] });
    s.device.state = { reachable: true, stationary: false, engineOff: false };
    assert.strictEqual(await s.bridge.handleJob(defaulted(s.leaseId)), "deferred");
    assert.strictEqual(s.device.sent.length, 0);
    let [cmd] = await s.commands();
    assert.strictEqual(cmd.status, "queued");
    assert.strictEqual(det(cmd.result_details).reason, "vehicle_in_use_waiting_for_next_stop");

    // stopped but engine still on: still no lock
    s.advance(120);
    s.device.state = { reachable: true, stationary: true, engineOff: false };
    await s.bridge.processQueued();
    assert.strictEqual(s.device.sent.length, 0);

    // stationary and engine off: lock
    s.advance(120);
    s.device.state = { reachable: true, stationary: true, engineOff: true };
    await s.bridge.processQueued();
    assert.strictEqual(s.device.sent.length, 1);
    assert.strictEqual(s.device.sent[0].command, "lock");
    [cmd] = await s.commands();
    assert.strictEqual(cmd.status, "acknowledged");
  });

  it("does not lock without a prior Grace notice", async () => {
    const s = await setup({ notices: [] });
    assert.strictEqual(await s.bridge.handleJob(defaulted(s.leaseId)), "deferred");
    assert.strictEqual(s.device.sent.length, 0);
    assert.strictEqual(det((await s.commands())[0].result_details).reason, "grace_notice_missing");
  });

  it("sends the pre-lock notice first and waits out the notice period before locking", async () => {
    const s = await setup({ notices: ["grace_entered"] });
    assert.strictEqual(await s.bridge.handleJob(defaulted(s.leaseId)), "deferred");
    assert.strictEqual(s.device.sent.length, 0);
    assert.match(s.sms.sent[0].text, /may be locked after.*only when it is safely stopped/);
    assert.strictEqual(await s.pool.query(`SELECT * FROM rider_notices WHERE kind = 'pre_lock';`).then((r) => r.rows.length), 1);

    s.advance(1800); // half the notice period
    await s.bridge.processQueued();
    assert.strictEqual(s.device.sent.length, 0);

    s.advance(1900); // past the period
    await s.bridge.processQueued();
    assert.strictEqual(s.device.sent.length, 1);
    assert.ok(s.sms.sent.some((m) => /vehicle is locked/.test(m.text)));
  });

  it("unlocks IMMEDIATELY on cure and retries until acknowledged", async () => {
    const s = await setup({ notices: ["grace_entered", "pre_lock"] });
    await s.bridge.handleJob(defaulted(s.leaseId));
    assert.strictEqual(s.device.locked.get("DEV-1"), true);

    s.chain.setStatus(s.leaseId, "Active"); // payment landed
    s.device.failSends = 1; // first attempt: transport error
    s.device.withholdAcks = 1; // second: delivered, no ack
    const out = await s.bridge.handleJob({ eventName: "cured", leaseId: s.leaseId, txHash: "tx2" });
    assert.strictEqual(out, "acknowledged"); // third inline attempt succeeds
    const unlockSends = s.device.sent.filter((c) => c.command === "unlock");
    assert.strictEqual(unlockSends.length, 3);
    assert.strictEqual(s.device.locked.get("DEV-1"), false);
    const unlock = (await s.commands()).find((c) => c.command === "unlock");
    assert.strictEqual(unlock.status, "acknowledged");
    assert.strictEqual(det(unlock.result_details).attempts, 3);
    assert.ok(s.sms.sent.some((m) => /unlocked/.test(m.text)));
  });

  it("keeps retrying an unacknowledged unlock from the sweeper (no backoff, no giving up)", async () => {
    const s = await setup({ notices: ["grace_entered", "pre_lock"] });
    s.chain.setStatus(s.leaseId, "Active");
    s.device.withholdAcks = 5;
    assert.strictEqual(await s.bridge.handleJob({ eventName: "cured", leaseId: s.leaseId, txHash: "t" }), "deferred");
    assert.strictEqual((await s.commands())[0].status, "queued");
    await s.bridge.processQueued(); // attempts 4-6; 5th/6th get acked
    assert.strictEqual((await s.commands())[0].status, "acknowledged");
  });

  it("completed also unlocks and tells the rider", async () => {
    const s = await setup({ notices: ["grace_entered", "pre_lock"] });
    s.chain.setStatus(s.leaseId, "Completed");
    assert.strictEqual(await s.bridge.handleJob({ eventName: "completed", leaseId: s.leaseId, txHash: "t" }), "acknowledged");
    assert.ok(s.sms.sent.some((m) => /now yours/.test(m.text)));
  });

  it("an automated unlock is refused if the chain still says Defaulted", async () => {
    const s = await setup({ notices: ["grace_entered", "pre_lock"] });
    assert.strictEqual(await s.bridge.handleJob({ eventName: "cured", leaseId: s.leaseId, txHash: "stale" }), "refused");
    assert.strictEqual(s.device.sent.length, 0);
  });

  it("an unlock supersedes a lock still waiting for a safe moment", async () => {
    const s = await setup({ notices: ["grace_entered", "pre_lock"] });
    s.device.state = { reachable: true, stationary: false, engineOff: false };
    await s.bridge.handleJob(defaulted(s.leaseId));
    s.chain.setStatus(s.leaseId, "Active");
    await s.bridge.handleJob({ eventName: "cured", leaseId: s.leaseId, txHash: "c" });
    const cmds = await s.commands();
    assert.strictEqual(cmds.find((c) => c.command === "lock").status, "failed");
    assert.strictEqual(det(cmds.find((c) => c.command === "lock").result_details).outcome, "superseded");
  });

  it("the same event delivered twice does not create a second command", async () => {
    const s = await setup({ notices: ["grace_entered", "pre_lock"] });
    await s.bridge.handleJob(defaulted(s.leaseId));
    await s.bridge.handleJob(defaulted(s.leaseId));
    assert.strictEqual((await s.commands()).length, 1);
    assert.strictEqual(s.device.sent.length, 1);
  });

  it("logs every command with trigger, timestamp and result", async () => {
    const s = await setup({ notices: ["grace_entered", "pre_lock"] });
    await s.bridge.handleJob(defaulted(s.leaseId));
    s.chain.setStatus(s.leaseId, "Active");
    await s.bridge.handleJob({ eventName: "cured", leaseId: s.leaseId, txHash: "tx9" });
    const cmds = await s.commands();
    assert.strictEqual(cmds.length, 2);
    for (const c of cmds) {
      assert.ok(c.triggered_by.startsWith("event:"));
      assert.ok(c.created_at);
      assert.ok(["acknowledged", "sent", "failed", "queued"].includes(c.status));
      assert.ok(det(c.result_details).lastAttemptAt);
    }
  });

  it("executes a manual lock queued by the API, with the same safety checks", async () => {
    const s = await setup({ notices: [] });
    const asset = (await s.pool.query(`SELECT asset_id FROM leases;`)).rows[0].asset_id;
    await s.pool.query(
      `INSERT INTO lock_commands (lease_id, asset_id, device_id, command, triggered_by, status, result_details)
       VALUES ($1, $2, 'DEV-1', 'lock', 'lessor_staff:abc', 'queued', '{"source":"manual"}');`,
      [s.leaseId, asset]
    );
    await s.bridge.processQueued();
    assert.strictEqual(s.device.sent.length, 0); // no notice yet => no lock
  });

  it("repossessed jobs send no device command", async () => {
    const s = await setup({ notices: ["grace_entered", "pre_lock"] });
    assert.strictEqual(await s.bridge.handleJob({ eventName: "repossessed", leaseId: s.leaseId }), "ignored");
    assert.strictEqual(s.device.sent.length, 0);
  });

  it("acceptance: Defaulted yields a lock command and a later payment yields an unlock, both logged", async () => {
    const s = await setup({ notices: ["grace_entered", "pre_lock"] });
    await s.bridge.handleJob(defaulted(s.leaseId));
    s.chain.setStatus(s.leaseId, "Active");
    await s.bridge.handleJob({ eventName: "cured", leaseId: s.leaseId, txHash: "paid" });
    assert.deepStrictEqual((await s.commands()).map((c) => [c.command, c.status]), [["lock", "acknowledged"], ["unlock", "acknowledged"]]);
  });
});

describe("device adapters", () => {
  it("manual driver records the intent and stays 'sent' for the lessor to action", async () => {
    const s = await setup({ notices: ["grace_entered", "pre_lock"] });
    const manual = new ManualDriver();
    const { LockBridge: LB } = await import("../src/index.js");
    const { Notifier: N } = await import("@mallaka/notifier");
    const bridge = new LB({ db: s.pool, chain: s.chain, device: manual, notifier: new N({ driver: s.sms, db: s.pool, contactSecret: SECRET }), preLockDelaySeconds: 3600, now: () => s.clock.now });
    assert.strictEqual(await bridge.handleJob(defaulted(s.leaseId)), "sent");
    assert.strictEqual(manual.intents.length, 1);
    assert.strictEqual((await s.commands())[0].status, "sent");
  });

  it("vendor driver authenticates with the API key only and never sends keys to the device", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const d = new VendorHttpDriver({
      baseUrl: "https://vendor.example",
      apiKey: "vendor-key",
      fetchFn: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => (url.endsWith("/status") ? { online: true, speed_kmh: 0, ignition: "off" } : { acknowledged: true }) };
      }) as unknown as typeof fetch,
    });
    assert.deepStrictEqual(await d.getState("D1"), { reachable: true, stationary: true, engineOff: true });
    const res = await d.send({ deviceId: "D1", command: "lock", commandId: "c1" });
    assert.strictEqual(res.acknowledged, true);
    assert.strictEqual((calls[1].init.headers as Record<string, string>).Authorization, "Bearer vendor-key");
    assert.deepStrictEqual(JSON.parse(String(calls[1].init.body)), { action: "engage", reference: "c1" });
    assert.ok(!/secret|wallet|stellar/i.test(String(calls[1].init.body)));
  });
});
