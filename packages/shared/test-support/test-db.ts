import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { newDb } from "pg-mem";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../src/db/migrations");

/**
 * Test helper: an in-memory Postgres (pg-mem) with every migration applied.
 * The plpgsql audit trigger is not supported by pg-mem, so it is replaced by
 * hooks that make audit_log append-only, mirroring the real trigger.
 * Returns a `pg`-compatible pool-like object.
 */
export function createTestDb() {
  const memDb = newDb();
  memDb.public.registerFunction({ name: "gen_random_uuid", impure: true, implementation: () => crypto.randomUUID() });
  memDb.registerExtension("uuid-ossp", (schema) => {
    schema.registerFunction({ name: "uuid_generate_v4", implementation: () => crypto.randomUUID() });
  });

  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    memDb.public.none(sql.split("-- Enforce append-only")[0]);
  }

  const audit = memDb.public.getTable("audit_log");
  const refuse = () => {
    throw new Error("audit_log table is append-only. UPDATE and DELETE operations are prohibited.");
  };
  audit.update = refuse;
  audit.delete = refuse;

  const adapter = memDb.adapters.createPg();
  const client = new adapter.Client();
  client.connect();
  const pool = {
    query: (sql: string, params?: unknown[]) => client.query(sql, params),
    // Single shared connection: transactions are not isolated, which is fine for unit tests.
    connect: async () => ({ query: (sql: string, params?: unknown[]) => client.query(sql, params), release: () => {} }),
    end: async () => {},
  };
  return { memDb, pool };
}

/** Inserts a lessor, asset, rider and lease so service tests have something to work on. */
export async function seedLease(
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  overrides: Partial<{ id: number; status: string; paid: string; lessee: string }> = {}
) {
  const id = overrides.id ?? 1;
  const lessor = await pool.query(
    `INSERT INTO lessors (name, stellar_address) VALUES ('Test Lessor', $1) RETURNING id;`,
    [`GLESSOR${id}`]
  );
  const lessorId = lessor.rows[0].id;
  const asset = await pool.query(
    `INSERT INTO assets (lessor_id, vin_or_serial, asset_type, device_id, asset_hash)
     VALUES ($1, $2, 'motorcycle', $3, $4) RETURNING id;`,
    [lessorId, `VIN-${id}`, `DEV-${id}`, "ab".repeat(32)]
  );
  await pool.query(
    `INSERT INTO leases (id, lessor_id, asset_id, lessor_address, lessee_address, token_address,
       title_contract_address, total_price, deposit, installment, interval_seconds,
       grace_period_seconds, repossession_wait_seconds, paid, start_ts, status)
     VALUES ($1, $2, $3, $4, $5, 'GTOKEN', 'GTITLE', 100000000, 10000000, 10000000, 86400, 172800, 259200, $6, 1000, $7);`,
    [id, lessorId, asset.rows[0].id, `GLESSOR${id}`, overrides.lessee ?? `GRIDER${id}`, overrides.paid ?? "0", overrides.status ?? "Active"]
  );
  return { leaseId: String(id), lessorId: lessorId as string, assetId: asset.rows[0].id as string };
}
