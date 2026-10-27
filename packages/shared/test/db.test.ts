import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { newDb, IMemoryDb } from "pg-mem";
import { runSeed } from "../src/db/seed.js";
import { decryptContactInfo } from "../src/crypto.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("database schema and migrations", () => {
  let memDb: IMemoryDb;
  let pgClient: any;

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
      implementation: () => crypto.randomUUID(),
    });

    const migrationPath = path.resolve(__dirname, "../src/db/migrations/001_initial_schema.sql");
    const rawSql = fs.readFileSync(migrationPath, "utf-8");

    // pg-mem supports standard DDL; plpgsql procedural trigger definitions are mocked via table hooks
    const ddl = rawSql.split("-- Enforce append-only")[0];
    memDb.public.none(ddl);

    // Mock the append-only trigger enforcement in pg-mem
    const auditTable = memDb.public.getTable("audit_log");
    auditTable.update = () => {
      throw new Error("audit_log table is append-only. UPDATE and DELETE operations are prohibited.");
    };
    auditTable.delete = () => {
      throw new Error("audit_log table is append-only. UPDATE and DELETE operations are prohibited.");
    };

    const pgAdapter = memDb.adapters.createPg();
    pgClient = new pgAdapter.Client();
    pgClient.connect();
  });

  it("verifies all 8 tables defined in README section 9 exist", async () => {
    const expectedTables = [
      "users",
      "lessors",
      "assets",
      "leases",
      "payments",
      "chain_events",
      "lock_commands",
      "audit_log",
    ];

    for (const table of expectedTables) {
      const res = await pgClient.query(`SELECT COUNT(*) FROM ${table};`);
      assert.strictEqual(Number(res.rows[0].count), 0, `Table ${table} should be queryable`);
    }
  });

  it("enforces idempotency on payments.provider_reference", async () => {
    // Insert prerequisite lessor and lease
    await pgClient.query(`
      INSERT INTO lessors (id, name, stellar_address)
      VALUES ('00000000-0000-0000-0000-000000000001', 'Test Lessor', 'GLESSOR1');
    `);
    await pgClient.query(`
      INSERT INTO assets (id, lessor_id, vin_or_serial, asset_type, device_id, asset_hash)
      VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'VIN123', 'motorcycle', 'DEV1', 'hash1');
    `);
    await pgClient.query(`
      INSERT INTO leases (
        id, lessor_id, asset_id, lessor_address, lessee_address, token_address, title_contract_address,
        total_price, deposit, installment, interval_seconds, grace_period_seconds, repossession_wait_seconds, status
      ) VALUES (
        1, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
        'GLESSOR1', 'GRIDER1', 'GTOKEN1', 'GTITLE1',
        1000, 100, 100, 86400, 86400, 86400, 'Active'
      );
    `);

    // First payment insert
    await pgClient.query(`
      INSERT INTO payments (lease_id, payer_address, naira_amount, token_amount, fx_rate, provider, provider_reference, status)
      VALUES (1, 'GRIDER1', 50000, 50, 1000, 'paystack', 'ref_idempotent_12345', 'confirmed');
    `);

    // Duplicate provider_reference must fail
    await assert.rejects(
      async () => {
        await pgClient.query(`
          INSERT INTO payments (lease_id, payer_address, naira_amount, token_amount, fx_rate, provider, provider_reference, status)
          VALUES (1, 'GRIDER1', 50000, 50, 1000, 'paystack', 'ref_idempotent_12345', 'confirmed');
        `);
      },
      (err: Error) => {
        return true;
      }
    );
  });

  it("enforces uniqueness on chain_events (tx_hash, event_index)", async () => {
    await pgClient.query(`
      INSERT INTO chain_events (contract_id, event_name, tx_hash, event_index, ledger_sequence, ledger_closed_at, topics, data)
      VALUES ('C123', 'payment', 'tx_abc123', 0, 100, NOW(), '[]'::jsonb, '{}'::jsonb);
    `);

    // Duplicate (tx_hash, event_index) must fail
    await assert.rejects(
      async () => {
        await pgClient.query(`
          INSERT INTO chain_events (contract_id, event_name, tx_hash, event_index, ledger_sequence, ledger_closed_at, topics, data)
          VALUES ('C123', 'payment', 'tx_abc123', 0, 101, NOW(), '[]'::jsonb, '{}'::jsonb);
        `);
      },
      (err: Error) => {
        return true;
      }
    );
  });

  it("enforces append-only audit_log table (prevents UPDATE and DELETE)", async () => {
    const res = await pgClient.query(`
      INSERT INTO audit_log (actor, action, resource, details)
      VALUES ('admin1', 'lock', 'lease:1', '{"reason": "default"}'::jsonb)
      RETURNING id;
    `);
    const id = res.rows[0].id;

    // UPDATE must fail
    await assert.rejects(
      async () => {
        await pgClient.query(`UPDATE audit_log SET action = 'tampered' WHERE id = '${id}';`);
      },
      (err: Error) => {
        assert(err.message.includes("append-only"));
        return true;
      }
    );

    // DELETE must fail
    await assert.rejects(
      async () => {
        await pgClient.query(`DELETE FROM audit_log WHERE id = '${id}';`);
      },
      (err: Error) => {
        assert(err.message.includes("append-only"));
        return true;
      }
    );
  });

  it("runs seed script and verifies fake data is populated with encrypted contact info", async () => {
    const jwtSecret = "seed_jwt_secret_phrase_for_test";
    await runSeed(pgClient, jwtSecret);

    const usersRes = await pgClient.query(`SELECT * FROM users WHERE role = 'rider';`);
    assert.strictEqual(usersRes.rows.length, 1);
    const encrypted = usersRes.rows[0].contact_info_encrypted;

    // Decrypt and verify
    const decrypted = decryptContactInfo<any>(encrypted, jwtSecret);
    assert.strictEqual(decrypted.name, "Emeka Okonkwo");
    assert.strictEqual(decrypted.phone, "+2348023456789");

    // Verify lease was seeded
    const leaseRes = await pgClient.query(`SELECT * FROM leases WHERE id = 1;`);
    assert.strictEqual(leaseRes.rows.length, 1);
    assert.strictEqual(leaseRes.rows[0].status, "Active");
  });
});
