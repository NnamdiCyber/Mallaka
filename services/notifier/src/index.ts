export * from "./types.js";
export * from "./templates.js";
export * from "./drivers.js";
export * from "./notifier.js";

import pg from "pg";
import { Worker } from "bullmq";
import { loadConfig, createLogger } from "@mallaka/shared";
import { driverFromConfig } from "./drivers.js";
import { Notifier } from "./notifier.js";

/** Standalone worker: consumes the indexer's "notifications" queue and sends due-soon reminders hourly. */
export async function startNotifierService() {
  const config = loadConfig();
  const logger = createLogger("notifier");
  const db = new pg.Pool({ connectionString: config.DATABASE_URL });
  const notifier = new Notifier({
    driver: driverFromConfig(config),
    db,
    contactSecret: config.JWT_SECRET ?? "default_local_dev_secret_key_32chars!",
    logger,
  });

  let worker: Worker | undefined;
  if (config.REDIS_URL) {
    worker = new Worker(
      "notifications",
      async (job) => {
        await notifier.handleEvent(job.data as { eventName: string; leaseId?: string; data?: unknown });
      },
      { connection: { url: config.REDIS_URL } }
    );
  }
  setInterval(
    () => void notifier.sendDueSoonReminders(Math.floor(Date.now() / 1000)).catch((e) => logger.error("due-soon sweep failed", { error: String(e) })),
    3600_000
  );
  logger.info("Notifier running", { queue: Boolean(config.REDIS_URL) });
  return { notifier, worker, db };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startNotifierService().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
