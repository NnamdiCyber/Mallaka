import { describe, it } from "node:test";
import assert from "node:assert";
import { encryptContactInfo, phoneHash } from "@mallaka/shared";
import { createTestDb, seedLease } from "../../../packages/shared/test-support/test-db.js";
import { handleUssd } from "../src/menu.js";
import { buildUssdApp } from "../src/server.js";

const SECRET = "ussd_test_jwt_secret_key_32chars!";
const PHONE = "+2348011223344";

async function setup() {
  const { pool } = createTestDb();
  const { leaseId } = await seedLease(pool, { status: "Active" });
  const ph = phoneHash(PHONE, SECRET);
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (role, contact_info_encrypted, phone_hash) VALUES ('rider', $1, $2) RETURNING id;`,
    [encryptContactInfo({ phone: PHONE }, SECRET), ph]
  );
  await pool.query(`UPDATE leases SET lessee_id = $1 WHERE id = $2;`, [user.rows[0].id, leaseId]);
  return { pool, leaseId, userId: user.rows[0].id };
}

describe("USSD Flow", () => {
  it("rejects unknown phone numbers with polite exit message", async () => {
    const { pool } = await setup();
    const res = await handleUssd(
      { sessionId: "s1", serviceCode: "*384*22#", phoneNumber: "+2348099999999", text: "" },
      { db: pool, jwtSecret: SECRET }
    );
    assert.match(res, /^END Welcome to Mallaka/);
    assert.match(res, /not registered/);
  });

  it("returns main menu on initial dial", async () => {
    const { pool } = await setup();
    const res = await handleUssd(
      { sessionId: "s2", serviceCode: "*384*22#", phoneNumber: PHONE, text: "" },
      { db: pool, jwtSecret: SECRET }
    );
    assert.match(res, /^CON Welcome to Mallaka/);
    assert.match(res, /1\. Lease Status & Balance/);
    assert.match(res, /2\. Next Due Date/);
    assert.match(res, /3\. Lock & Safety Status/);
    assert.match(res, /4\. Pay Installment/);
  });

  it("handles option 1: Lease Status & Balance", async () => {
    const { pool } = await setup();
    const res = await handleUssd(
      { sessionId: "s3", serviceCode: "*384*22#", phoneNumber: PHONE, text: "1" },
      { db: pool, jwtSecret: SECRET }
    );
    assert.match(res, /^END Lease Status: Active/);
    assert.match(res, /Total:/);
    assert.match(res, /Paid:/);
    assert.match(res, /Remaining:/);
  });

  it("handles option 2: Next Due Date", async () => {
    const { pool } = await setup();
    const res = await handleUssd(
      { sessionId: "s4", serviceCode: "*384*22#", phoneNumber: PHONE, text: "2" },
      { db: pool, jwtSecret: SECRET }
    );
    assert.match(res, /^END Next Due Date/);
    assert.match(res, /Installment:/);
    assert.match(res, /Status: Active/);
  });

  it("handles option 3: Lock & Safety Status for Active and Defaulted leases", async () => {
    const { pool, leaseId } = await setup();
    // Active lease
    const resActive = await handleUssd(
      { sessionId: "s5a", serviceCode: "*384*22#", phoneNumber: PHONE, text: "3" },
      { db: pool, jwtSecret: SECRET }
    );
    assert.match(resActive, /Status: UNLOCKED/);

    // Defaulted lease
    await pool.query(`UPDATE leases SET status = 'Defaulted' WHERE id = $1;`, [leaseId]);
    const resDefaulted = await handleUssd(
      { sessionId: "s5b", serviceCode: "*384*22#", phoneNumber: PHONE, text: "3" },
      { db: pool, jwtSecret: SECRET }
    );
    assert.match(resDefaulted, /Status: DEFAULTED/);
  });

  it("handles option 4: Payment initiation via USSD prompt", async () => {
    const { pool, leaseId } = await setup();
    // Prompt for amount
    const prompt = await handleUssd(
      { sessionId: "s6", serviceCode: "*384*22#", phoneNumber: PHONE, text: "4" },
      { db: pool, jwtSecret: SECRET }
    );
    assert.match(prompt, /^CON Enter amount in Naira/);

    // Enter amount
    const initiated = await handleUssd(
      { sessionId: "s6", serviceCode: "*384*22#", phoneNumber: PHONE, text: "4*3500" },
      { db: pool, jwtSecret: SECRET }
    );
    assert.match(initiated, /^END Payment initiated for N3,500/);
    assert.match(initiated, /Ref: mlk_ussd_/);

    // Check payment intent saved in database
    const intentRes = await pool.query<{ reference: string; naira_amount: string }>(
      `SELECT reference, naira_amount FROM payment_intents WHERE lease_id = $1;`,
      [String(leaseId)]
    );
    assert.strictEqual(intentRes.rows.length, 1);
    assert.strictEqual(Number(intentRes.rows[0].naira_amount), 3500);
  });

  it("serves USSD HTTP endpoint properly", async () => {
    const { pool } = await setup();
    const app = buildUssdApp({ db: pool, jwtSecret: SECRET });

    const response = await app.inject({
      method: "POST",
      url: "/ussd",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      payload: "sessionId=http_s1&phoneNumber=%2B2348011223344&text=1",
    });

    assert.strictEqual(response.statusCode, 200);
    assert.match(response.body, /^END Lease Status: Active/);
  });
});
