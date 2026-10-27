import pg from "pg";
import { loadConfig } from "../config.js";
import { encryptContactInfo } from "../crypto.js";

const { Pool } = pg;

export async function runSeed(client: pg.PoolClient | pg.ClientBase, jwtSecret = "default_local_dev_secret_key_32chars!"): Promise<void> {
  // 1. Seed Lessor
  const lessorRes = await client.query<{ id: string }>(`
    INSERT INTO lessors (name, stellar_address, payout_settings)
    VALUES (
      'Lagos Moto Fleet Ltd',
      'GBLXXOR4MALLAKA7LESSORTESTNETADDRESSFAKEPUBLICKEYDEMO1',
      '{"bank_code": "058", "account_number": "0123456789", "split_percentage": 100}'::jsonb
    )
    ON CONFLICT (stellar_address) DO UPDATE SET name = EXCLUDED.name
    RETURNING id;
  `);
  const lessorId = lessorRes.rows[0].id;

  // 2. Seed Rider User with encrypted contact info (NO plaintext PII)
  const contactData = {
    name: "Emeka Okonkwo",
    phone: "+2348023456789",
    email: "emeka.rider@example.com",
    city: "Ikeja, Lagos",
  };
  const encryptedContact = encryptContactInfo(contactData, jwtSecret);

  const riderRes = await client.query<{ id: string }>(`
    INSERT INTO users (role, lessor_id, public_key, contact_info_encrypted)
    VALUES (
      'rider',
      $1,
      'GBRIDERTROOPERMALLAKAFAKEPUBLICKEYDEMO0000000000000000002',
      $2
    )
    RETURNING id;
  `, [lessorId, encryptedContact]);
  const riderId = riderRes.rows[0].id;

  // 3. Seed Asset
  const assetHash = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const assetRes = await client.query<{ id: string }>(`
    INSERT INTO assets (lessor_id, vin_or_serial, asset_type, photos, device_id, asset_hash)
    VALUES (
      $1,
      'VIN-BAJAJ-BOXER-BM100-2026-001',
      'motorcycle',
      '["https://example.com/assets/bajaj-front.jpg", "https://example.com/assets/bajaj-side.jpg"]'::jsonb,
      'GPS-TRACKER-860123456789012',
      $2
    )
    ON CONFLICT (vin_or_serial) DO UPDATE SET device_id = EXCLUDED.device_id
    RETURNING id;
  `, [lessorId, assetHash]);
  const assetId = assetRes.rows[0].id;

  // 4. Seed Lease
  await client.query(`
    INSERT INTO leases (
      id, lessor_id, asset_id, lessee_id,
      lessor_address, lessee_address, token_address, title_contract_address,
      total_price, deposit, installment, interval_seconds, grace_period_seconds, repossession_wait_seconds,
      paid, start_ts, status
    ) VALUES (
      1, $1, $2, $3,
      'GBLXXOR4MALLAKA7LESSORTESTNETADDRESSFAKEPUBLICKEYDEMO1',
      'GBRIDERTROOPERMALLAKAFAKEPUBLICKEYDEMO0000000000000000002',
      'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      'CA52GFT2QVCTE7JS4KVMB2RK2SDSXJEG5D3DM24R3CA2VLWMWWM3I5VV',
      50000000, 5000000, 5000000, 86400, 172800, 259200,
      0, 1774000000, 'Active'
    )
    ON CONFLICT (id) DO NOTHING;
  `, [lessorId, assetId, riderId]);

  // 5. Seed Initial Audit Log
  await client.query(`
    INSERT INTO audit_log (actor, action, resource, details)
    VALUES (
      'system_seed',
      'create_initial_demo_lease',
      'lease:1',
      '{"status": "Active", "environment": "development"}'::jsonb
    );
  `);
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const client = await pool.connect();
  try {
    await runSeed(client, config.JWT_SECRET || "default_local_dev_secret_key_32chars!");
    // eslint-disable-next-line no-console
    console.log("[db:seed] Local development fake data seeded successfully.");
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[db:seed] Seeding error:", err);
    process.exit(1);
  });
}
