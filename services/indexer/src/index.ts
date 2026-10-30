export * from "./event-parser.js";
export * from "./indexer.js";

import pg from "pg";
import { Queue } from "bullmq";
import { rpc } from "@stellar/stellar-sdk";
import { loadConfig, createLogger } from "@mallaka/shared";
import { IndexerService } from "./indexer.js";

const { Pool } = pg;

export async function startIndexerService() {
  const config = loadConfig();
  const logger = createLogger("indexer");

  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const rpcServer = new rpc.Server(config.SOROBAN_RPC_URL, {
    allowHttp: config.SOROBAN_RPC_URL.startsWith("http://"),
  });

  let lockBridgeQueue: Queue | undefined;
  let notificationQueue: Queue | undefined;

  if (config.REDIS_URL) {
    lockBridgeQueue = new Queue("lock-commands", { connection: { url: config.REDIS_URL } });
    notificationQueue = new Queue("notifications", { connection: { url: config.REDIS_URL } });
  }

  const indexer = new IndexerService({
    pgPool: pool,
    rpcServer,
    leaseContractId: config.LEASE_CONTRACT_ID,
    titleRegistryContractId: config.TITLE_REGISTRY_CONTRACT_ID,
    lockBridgeQueue,
    notificationQueue,
    logger,
  });

  logger.info("Starting indexer service loop");
  return { indexer, pool, lockBridgeQueue, notificationQueue };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startIndexerService()
    .then(({ indexer }) => {
      setInterval(() => {
        indexer.pollOnce().catch((err) => {
          // eslint-disable-next-line no-console
          console.error("Indexer poll error:", err);
        });
      }, 5000);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Indexer startup error:", err);
      process.exit(1);
    });
}

