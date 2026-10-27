import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { newDb, IMemoryDb } from "pg-mem";
import { KeeperService } from "../src/keeper.js";

describe("KeeperService", () => {
  let memDb: IMemoryDb;
  let pgClient: any;
  let mockPool: any;

  beforeEach(() => {
    memDb = newDb();
    memDb.public.none(`
      CREATE TABLE IF NOT EXISTS leases (
        id BIGINT PRIMARY KEY,
        status TEXT NOT NULL,
        start_ts BIGINT NOT NULL DEFAULT 0,
        paid NUMERIC(38, 0) NOT NULL DEFAULT 0,
        installment NUMERIC(38, 0) NOT NULL DEFAULT 5000000,
        interval_seconds BIGINT NOT NULL DEFAULT 86400,
        grace_period_seconds BIGINT NOT NULL DEFAULT 172800
      );
    `);

    const pgAdapter = memDb.adapters.createPg();
    pgClient = new pgAdapter.Client();
    pgClient.connect();

    mockPool = {
      query: (sql: string, params?: any[]) => pgClient.query(sql, params),
    };
  });

  it("triggers check_default when lease is overdue and skips when on-time", async () => {
    // Lease 1: start_ts = 1000, paid = 0, interval = 100.
    // nextDue = 1000 + 1 * 100 = 1100. Overdue at now = 1200.
    await pgClient.query(`
      INSERT INTO leases (id, status, start_ts, paid, installment, interval_seconds, grace_period_seconds)
      VALUES (1, 'Active', 1000, 0, 100, 100, 50);
    `);

    // Lease 2: start_ts = 1000, paid = 500 (5 installments covered), interval = 100.
    // nextDue = 1000 + 6 * 100 = 1600. On time at now = 1200.
    await pgClient.query(`
      INSERT INTO leases (id, status, start_ts, paid, installment, interval_seconds, grace_period_seconds)
      VALUES (2, 'Active', 1000, 500, 100, 100, 50);
    `);

    const invokedLeases: bigint[] = [];
    const keeper = new KeeperService({
      pgPool: mockPool,
      chainClient: {} as any,
      leaseContractId: "CDNZLEASEID",
    });

    // Mock contract call
    keeper.invokeCheckDefault = async (leaseId: bigint) => {
      invokedLeases.push(leaseId);
    };

    const res = await keeper.scanAndCheckDefaults(1200);

    assert.strictEqual(res.processed, 1);
    assert.strictEqual(res.errors, 0);
    assert.deepStrictEqual(invokedLeases, [1n]); // Only overdue lease 1 was invoked!
  });

  it("scans and extends TTL for all non-terminal leases", async () => {
    await pgClient.query(`
      INSERT INTO leases (id, status) VALUES
      (10, 'Pending'),
      (20, 'Active'),
      (30, 'Grace'),
      (40, 'Defaulted');
    `);

    const extendedLeases: bigint[] = [];
    const keeper = new KeeperService({
      pgPool: mockPool,
      chainClient: {} as any,
      leaseContractId: "CDNZLEASEID",
    });

    keeper.invokeExtendTtl = async (leaseId: bigint) => {
      extendedLeases.push(leaseId);
    };

    const res = await keeper.scanAndExtendTtls();
    assert.strictEqual(res.processed, 4);
    assert.strictEqual(res.errors, 0);
    assert.deepStrictEqual(extendedLeases, [10n, 20n, 30n, 40n]);
  });

  it("isolates errors per lease so failure on one does not block other leases", async () => {
    // 2 overdue leases
    await pgClient.query(`
      INSERT INTO leases (id, status, start_ts, paid, installment, interval_seconds)
      VALUES
      (101, 'Active', 1000, 0, 100, 100),
      (102, 'Active', 1000, 0, 100, 100);
    `);

    const attemptedLeases: bigint[] = [];
    const keeper = new KeeperService({
      pgPool: mockPool,
      chainClient: {} as any,
      leaseContractId: "CDNZLEASEID",
    });

    keeper.invokeCheckDefault = async (leaseId: bigint) => {
      attemptedLeases.push(leaseId);
      if (leaseId === 101n) {
        throw new Error("RPC network simulated failure on lease 101");
      }
    };

    const res = await keeper.scanAndCheckDefaults(2000);

    // Lease 101 failed, but Lease 102 was processed!
    assert.strictEqual(res.processed, 1);
    assert.strictEqual(res.errors, 1);
    assert.deepStrictEqual(attemptedLeases, [101n, 102n]);
  });
});
