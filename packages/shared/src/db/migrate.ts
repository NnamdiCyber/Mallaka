import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "../config.js";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(client: pg.PoolClient | pg.ClientBase): Promise<string[]> {
  // Ensure migrations tracking table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const appliedRes = await client.query<{ name: string }>(
    `SELECT name FROM _migrations ORDER BY id ASC;`
  );
  const appliedSet = new Set(appliedRes.rows.map((r) => r.name));

  const migrationsDir = path.resolve(__dirname, "migrations");
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const newlyApplied: string[] = [];

  for (const file of files) {
    if (appliedSet.has(file)) {
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, "utf-8");

    await client.query("BEGIN;");
    try {
      await client.query(sql);
      await client.query(`INSERT INTO _migrations (name) VALUES ($1);`, [file]);
      await client.query("COMMIT;");
      newlyApplied.push(file);
      // eslint-disable-next-line no-console
      console.log(`[db:migrate] Applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK;");
      throw new Error(`Failed to apply migration ${file}: ${(err as Error).message}`);
    }
  }

  return newlyApplied;
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const client = await pool.connect();
  try {
    const applied = await runMigrations(client);
    // eslint-disable-next-line no-console
    console.log(`[db:migrate] Completed successfully. ${applied.length} new migration(s) applied.`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[db:migrate] Migration error:", err);
    process.exit(1);
  });
}
