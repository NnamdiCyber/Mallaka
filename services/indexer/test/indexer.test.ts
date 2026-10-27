import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { newDb, IMemoryDb } from "pg-mem";
import { IndexerService } from "../src/indexer.js";
import { parseSorobanEvent } from "../src/event-parser.js";
import { xdr, scValToNative } from "@stellar/stellar-sdk";

describe("IndexerService", () => {
  let memDb: IMemoryDb;
  let pgClient: any;
  let mockPool: any;

  beforeEach(() => {
    memDb = newDb();
    memDb.registerExtension("uuid-ossp", (schema) => {
      schema.registerFunction({
        name: "uuid_generate_v4",
        implementation: () => crypto.randomUUID(),
      });
    });
    memDb.public.registerFunction({
      name: "gen_random_uuid",
      impure: true,
      implementation: () => crypto.randomUUID(),
    });

    // Create required tables in pg-mem
    memDb.public.none(`
      CREATE TABLE IF NOT EXISTS chain_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contract_id TEXT NOT NULL,
        event_name TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        event_index INTEGER NOT NULL,
        ledger_sequence BIGINT NOT NULL,
        ledger_closed_at TIMESTAMPTZ NOT NULL,
        topics JSONB NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_chain_events_tx_index UNIQUE (tx_hash, event_index)
      );

      CREATE TABLE IF NOT EXISTS leases (
        id BIGINT PRIMARY KEY,
        status TEXT NOT NULL,
        start_ts BIGINT NOT NULL DEFAULT 0,
        paid NUMERIC(38, 0) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const pgAdapter = memDb.adapters.createPg();
    pgClient = new pgAdapter.Client();
    pgClient.connect();

    mockPool = {
      connect: async () => {
        const client = new pgAdapter.Client();
        await client.connect();
        return client;
      },
      query: (sql: string, params?: any[]) => pgClient.query(sql, params),
    };
  });

  it("parses raw Soroban contract events correctly matching README 7.4", () => {
    const topic0 = xdr.ScVal.scvSymbol("payment");
    const topic1 = xdr.ScVal.scvU64(42n);
    const topic2 = xdr.ScVal.scvString("GRIDERTESTPUBLICKEY");
    // data tuple: (amount: 5000000, paid_total: 10000000, next_due: 1774000000)
    const dataVal = xdr.ScVal.scvVec([
      xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: 5000000n, hi: 0n as any })),
      xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: 10000000n, hi: 0n as any })),
      xdr.ScVal.scvU64(1774000000n),
    ]);

    const rawEvent = {
      contractId: "CDNZLEASECONTRACTID",
      ledger: 10500,
      ledgerClosedAt: "2026-01-01T12:00:00Z",
      id: "evt_tx_1_0",
      txHash: "tx_hash_1",
      topic: [topic0.toXDR("base64"), topic1.toXDR("base64"), topic2.toXDR("base64")],
      value: dataVal.toXDR("base64"),
    } as any;

    const parsed = parseSorobanEvent(rawEvent, 0);
    assert.strictEqual(parsed.contractId, "CDNZLEASECONTRACTID");
    assert.strictEqual(parsed.eventName, "payment");
    assert.strictEqual(parsed.leaseId, 42n);
    assert.strictEqual(parsed.ledger, 10500);
  });

  it("persists event and cursor to chain_events before fan-out and resumes cursor", async () => {
    const indexer = new IndexerService({
      pgPool: mockPool,
      rpcServer: {} as any,
      leaseContractId: "CDNZLEASECONTRACTID",
    });

    const parsedEvent = {
      contractId: "CDNZLEASECONTRACTID",
      eventName: "activated",
      txHash: "tx_activation_001",
      eventIndex: 0,
      ledger: 25000,
      ledgerClosedAt: new Date(),
      topics: ["activated", 1n],
      data: [1774000000n, 5000000n],
      leaseId: 1n,
    };

    // Pre-insert lease into leases table
    await pgClient.query(`INSERT INTO leases (id, status) VALUES (1, 'Pending');`);

    const client = await mockPool.connect();
    const inserted = await indexer.processEvent(client, parsedEvent);
    client.release();

    assert.strictEqual(inserted, true);

    // Verify stored cursor matches ledger 25000
    const cursor = await indexer.getStoredCursor();
    assert.strictEqual(cursor, 25000);

    // Verify lease cache status was updated to Active
    const leaseRes = await pgClient.query(`SELECT status FROM leases WHERE id = 1;`);
    assert.strictEqual(leaseRes.rows[0].status, "Active");
  });

  it("enforces idempotency: duplicate event with same tx_hash and event_index is skipped", async () => {
    const indexer = new IndexerService({
      pgPool: mockPool,
      rpcServer: {} as any,
      leaseContractId: "CDNZLEASECONTRACTID",
    });

    const parsedEvent = {
      contractId: "CDNZLEASECONTRACTID",
      eventName: "grace_entered",
      txHash: "tx_grace_001",
      eventIndex: 0,
      ledger: 25001,
      ledgerClosedAt: new Date(),
      topics: ["grace_entered", 1n],
      data: [1774086400n, 1774259200n],
      leaseId: 1n,
    };

    await pgClient.query(`INSERT INTO leases (id, status) VALUES (1, 'Active');`);

    const client = await mockPool.connect();
    const firstInsert = await indexer.processEvent(client, parsedEvent);
    const secondInsert = await indexer.processEvent(client, parsedEvent);
    client.release();

    assert.strictEqual(firstInsert, true);
    assert.strictEqual(secondInsert, false); // duplicate skipped!
  });

  it("fans out lock events to Lock Bridge queue and notification events to Notification queue", async () => {
    const lockJobs: any[] = [];
    const notifyJobs: any[] = [];

    const mockLockQueue = {
      add: async (name: string, data: any) => {
        lockJobs.push({ name, data });
      },
    } as any;

    const mockNotifyQueue = {
      add: async (name: string, data: any) => {
        notifyJobs.push({ name, data });
      },
    } as any;

    const indexer = new IndexerService({
      pgPool: mockPool,
      rpcServer: {} as any,
      leaseContractId: "CDNZLEASECONTRACTID",
      lockBridgeQueue: mockLockQueue,
      notificationQueue: mockNotifyQueue,
    });

    await pgClient.query(`INSERT INTO leases (id, status) VALUES (2, 'Active');`);

    const client = await mockPool.connect();

    // Defaulted event -> Lock Bridge
    await indexer.processEvent(client, {
      contractId: "CDNZLEASECONTRACTID",
      eventName: "defaulted",
      txHash: "tx_def_001",
      eventIndex: 0,
      ledger: 25002,
      ledgerClosedAt: new Date(),
      topics: ["defaulted", 2n],
      data: 5000000n,
      leaseId: 2n,
    });

    // Grace entered event -> Notifications
    await indexer.processEvent(client, {
      contractId: "CDNZLEASECONTRACTID",
      eventName: "grace_entered",
      txHash: "tx_grace_002",
      eventIndex: 0,
      ledger: 25003,
      ledgerClosedAt: new Date(),
      topics: ["grace_entered", 2n],
      data: [1774000000n, 1774100000n],
      leaseId: 2n,
    });

    client.release();

    assert.strictEqual(lockJobs.length, 1);
    assert.strictEqual(lockJobs[0].name, "lock:defaulted");
    assert.strictEqual(lockJobs[0].data.leaseId, "2");

    assert.strictEqual(notifyJobs.length, 1);
    assert.strictEqual(notifyJobs[0].name, "notify:grace_entered");
    assert.strictEqual(notifyJobs[0].data.leaseId, "2");
  });
});
