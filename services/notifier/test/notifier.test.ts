import { describe, it } from "node:test";
import assert from "node:assert";
import { encryptContactInfo } from "@mallaka/shared";
import { createTestDb, seedLease } from "../../../packages/shared/test-support/test-db.js";
import {
  AfricasTalkingDriver,
  ConsoleDriver,
  Notifier,
  TEMPLATE_PARAMS,
  formatDate,
  render,
  tokenToNairaText,
  maskPhone,
  type TemplateId,
} from "../src/index.js";
import { HA_REVIEWED, ha } from "../src/locales/ha.js";

const SECRET = "notifier_test_secret_phrase_0001";

describe("templates", () => {
  it("renders every template with the correct values", () => {
    assert.strictEqual(
      render("payment_received", "en", { amount: "15,000", balance: "120,000" }),
      "Mallaka: we received your payment of N15,000. Balance remaining: N120,000. Thank you."
    );
    assert.match(render("due_soon", "en", { amount: "5,000", dueDate: "30 Oct 2026" }), /N5,000 is due on 30 Oct 2026/);
    const grace = render("grace_entered", "en", { amount: "5,000", dueDate: "30 Oct 2026", graceEnds: "1 Nov 2026" });
    assert.match(grace, /was due on 30 Oct 2026/);
    assert.match(grace, /until 1 Nov 2026/);
    assert.match(render("pre_lock", "en", { lockAfter: "2 Nov 2026", amount: "5,000" }), /after 2 Nov 2026.*only when it is safely stopped.*N5,000/);
    assert.match(render("lock_engaged", "en", { amount: "5,000" }), /locked.*N5,000/);
    assert.match(render("unlock_confirmed", "en"), /unlocked/);
    assert.match(render("lease_completed", "en"), /now yours/);
    assert.match(render("otp", "en", { code: "123456" }), /123456/);
  });

  it("every template id has English text and no unfilled placeholders after rendering", () => {
    for (const id of Object.keys(TEMPLATE_PARAMS) as TemplateId[]) {
      const params = Object.fromEntries(TEMPLATE_PARAMS[id].map((k) => [k, "X"]));
      assert.doesNotMatch(render(id, "en", params), /[{}]/);
    }
  });

  it("throws when a required value is missing", () => {
    assert.throws(() => render("payment_received", "en", { amount: "1" }), /balance/);
  });

  it("locale mechanism falls back to English; Hausa is an unreviewed placeholder", () => {
    assert.strictEqual(HA_REVIEWED, false);
    assert.deepStrictEqual(ha, {}); // no machine translation shipped
    assert.strictEqual(render("unlock_confirmed", "ha"), render("unlock_confirmed", "en"));
    assert.strictEqual(render("unlock_confirmed", "yo"), render("unlock_confirmed", "en"));
  });

  it("messages contain no personal data fields", () => {
    for (const id of Object.keys(TEMPLATE_PARAMS) as TemplateId[]) {
      assert.deepStrictEqual(
        TEMPLATE_PARAMS[id].filter((k) => /name|phone|address|nin|bvn/i.test(k)),
        []
      );
    }
  });
});

describe("formatting", () => {
  it("formats naira from token units and dates in UTC", () => {
    assert.strictEqual(tokenToNairaText(100_000_000n, "1500.000000"), "15,000");
    assert.strictEqual(tokenToNairaText(1n, "1500.000000"), "0");
    assert.strictEqual(formatDate(1792000000), "14 Oct 2026");
    assert.strictEqual(maskPhone("+2348023456789"), "**********6789");
  });
});

describe("drivers", () => {
  it("console driver records messages", async () => {
    const d = new ConsoleDriver();
    await d.send("+2348023456789", "hi");
    assert.deepStrictEqual(d.sent, [{ to: "+2348023456789", text: "hi" }]);
  });

  it("Africa's Talking driver posts form data with the api key header", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const d = new AfricasTalkingDriver({
      apiKey: "k",
      username: "sandbox",
      fetchFn: (async (url: string, init: RequestInit) => {
        captured = { url, init };
        return { ok: true, status: 201 };
      }) as unknown as typeof fetch,
    });
    await d.send("+2348023456789", "hello");
    assert.strictEqual((captured!.init.headers as Record<string, string>).apiKey, "k");
    assert.match(String(captured!.init.body), /username=sandbox/);
    assert.match(String(captured!.init.body), /message=hello/);
  });

  it("Africa's Talking driver throws on HTTP failure", async () => {
    const d = new AfricasTalkingDriver({
      apiKey: "k",
      username: "u",
      fetchFn: (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch,
    });
    await assert.rejects(d.send("+234", "x"), /HTTP 500/);
  });
});

describe("Notifier with a database", () => {
  async function setup() {
    const { pool } = createTestDb();
    const { leaseId } = await seedLease(pool);
    const user = await pool.query(
      `INSERT INTO users (role, contact_info_encrypted) VALUES ('rider', $1) RETURNING id;`,
      [encryptContactInfo({ phone: "+2348023456789" }, SECRET)]
    );
    await pool.query(`UPDATE leases SET lessee_id = $1 WHERE id = $2;`, [user.rows[0].id, leaseId]);
    const driver = new ConsoleDriver();
    const notifier = new Notifier({ driver, db: pool, contactSecret: SECRET });
    return { pool, leaseId, driver, notifier };
  }

  it("records a grace_entered notice only after the message is sent", async () => {
    const s = await setup();
    assert.strictEqual(await s.notifier.hasNotice(s.leaseId, "grace_entered"), false);
    const ok = await s.notifier.handleEvent({ eventName: "grace_entered", leaseId: s.leaseId, data: [1792000000, 1792172800] });
    assert.strictEqual(ok, true);
    assert.strictEqual(await s.notifier.hasNotice(s.leaseId, "grace_entered"), true);
    assert.match(s.driver.sent[0].text, /was due on 14 Oct 2026.*until 16 Oct 2026/);
    // installment is 10,000,000 base units = 1 USD = N1,500 at the fallback rate
    assert.match(s.driver.sent[0].text, /N1,500/);
  });

  it("does not record a notice when the rider cannot be reached", async () => {
    const s = await setup();
    await s.pool.query(`UPDATE leases SET lessee_id = NULL;`);
    assert.strictEqual(await s.notifier.notifyLease(s.leaseId, "pre_lock", { lockAfter: "x", amount: "1" }), false);
    assert.strictEqual(await s.notifier.hasNotice(s.leaseId, "pre_lock"), false);
    assert.strictEqual(s.driver.sent.length, 0);
  });

  it("sends payment_received with amount and remaining balance", async () => {
    const s = await setup();
    // paid_total 20,000,000 of (100,000,000 - 10,000,000 deposit) -> 70,000,000 left = N10,500
    await s.notifier.handleEvent({ eventName: "payment", leaseId: s.leaseId, data: [10_000_000, 20_000_000, 5] });
    assert.match(s.driver.sent[0].text, /payment of N1,500\. Balance remaining: N10,500/);
  });

  it("sends a due-soon reminder once per installment", async () => {
    const s = await setup();
    // start_ts=1000, interval=86400, paid=0 -> next due 87400
    assert.strictEqual(await s.notifier.sendDueSoonReminders(87400 - 3600), 1);
    assert.strictEqual(await s.notifier.sendDueSoonReminders(87400 - 3000), 0);
    assert.match(s.driver.sent[0].text, /next payment/);
  });
});
