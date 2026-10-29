import crypto from "node:crypto";
import { encryptContactInfo, phoneHash } from "@mallaka/shared";
import { FixedRateProvider, InlineQueue, PaymentProcessor } from "@mallaka/payments";
import { ConsoleDriver, Notifier } from "@mallaka/notifier";
import { createTestDb } from "../../../packages/shared/test-support/test-db.js";
import { MockLeaseChain } from "../../../packages/shared/test-support/mock-chain.js";
import { buildApp } from "../src/app.js";
import { DevCheckout } from "../src/checkout.js";

export const SECRET = "api_test_secret_phrase_at_least_32_chars!!";
export const PAYSTACK = "sk_test_api";
export const RIDER_PHONE = "+2348023456789";
export const STAFF_PHONE = "+2348000000001";
export const STAFF2_PHONE = "+2348000000003";
export const ADMIN_PHONE = "+2348000000002";
export const RIDER_ADDR = "G" + "A".repeat(55);

export async function setup(opts: { threshold?: bigint; rateLimit?: { max: number; timeWindow: string }; now?: () => Date } = {}) {
  const { pool } = createTestDb();
  const chain = new MockLeaseChain();
  const driver = new ConsoleDriver();
  const notifier = new Notifier({ driver, db: pool, contactSecret: SECRET });
  const processor = new PaymentProcessor({ db: pool, chain, alert: () => {} });
  const queue = new InlineQueue();
  queue.setHandler((id) => processor.process(id));
  const codes: string[] = [];
  const app = await buildApp({
    db: pool,
    chain,
    otp: { sendOtp: async (phone, code) => { codes.push(code); await notifier.sendOtp(phone, code); } },
    fx: new FixedRateProvider("1500.000000"),
    payQueue: queue,
    checkout: { paystack: new DevCheckout() },
    jwtSecret: SECRET,
    paystackSecretKey: PAYSTACK,
    flutterwaveSecretHash: "flw",
    contracts: { titleRegistry: "CTITLE", token: "CTOKEN" },
    manualLockApprovalThreshold: opts.threshold ?? 1_000_000_000n,
    rateLimit: opts.rateLimit ?? { max: 1000, timeWindow: "1 minute" },
    now: opts.now,
  });

  const lessor = (await pool.query(`INSERT INTO lessors (name, stellar_address) VALUES ('Lagos Fleet', 'GLESSOR1') RETURNING id;`)).rows[0].id as string;
  const mkUser = async (role: string, phone: string, lessorId: string | null, key: string | null = null) =>
    (await pool.query(
      `INSERT INTO users (role, lessor_id, public_key, contact_info_encrypted, phone_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id;`,
      [role, lessorId, key, encryptContactInfo({ phone }, SECRET), phoneHash(phone, SECRET)]
    )).rows[0].id as string;
  const riderId = await mkUser("rider", RIDER_PHONE, lessor, RIDER_ADDR);
  const staffId = await mkUser("lessor_staff", STAFF_PHONE, lessor);
  const staff2Id = await mkUser("lessor_staff", STAFF2_PHONE, lessor);
  const adminId = await mkUser("admin", ADMIN_PHONE, null);

  const asset = (await pool.query(
    `INSERT INTO assets (lessor_id, vin_or_serial, asset_type, device_id, asset_hash) VALUES ($1,'VIN-1','motorcycle','DEV-1',$2) RETURNING id;`,
    [lessor, "ab".repeat(32)]
  )).rows[0].id as string;
  const addLease = async (id: number, status: string, paid = "0") => {
    await pool.query(
      `INSERT INTO leases (id, lessor_id, asset_id, lessee_id, lessor_address, lessee_address, token_address, title_contract_address,
         total_price, deposit, installment, interval_seconds, grace_period_seconds, repossession_wait_seconds, paid, start_ts, status)
       VALUES ($1,$2,$3,$4,'GLESSOR1',$5,'CTOKEN','CTITLE',1000000000,100000000,100000000,86400,172800,259200,$6,1000,$7);`,
      [id, lessor, asset, riderId, RIDER_ADDR, paid, status]
    );
    chain.addLease({ id: String(id), lessee: RIDER_ADDR, derivedStatus: status as never, storedStatus: status as never, remainingBalance: String(900_000_000n - BigInt(paid)), paid });
  };

  const token = (id: string, role: string, lessorId?: string) => app.jwt.sign({ id, role: role as never, ...(lessorId ? { lessorId } : {}) });
  return {
    app, pool, chain, codes, driver, lessor, riderId, staffId, staff2Id, adminId, addLease,
    riderToken: token(riderId, "rider"),
    staffToken: token(staffId, "lessor_staff", lessor),
    staff2Token: token(staff2Id, "lessor_staff", lessor),
    adminToken: token(adminId, "admin"),
    auth: (t: string) => ({ authorization: `Bearer ${t}` }),
  };
}

export const paystackSign = (body: string) => crypto.createHmac("sha512", PAYSTACK).update(body).digest("hex");
