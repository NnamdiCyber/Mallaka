export * from "./keeper.js";

import pg from "pg";
import { loadConfig, createLogger, ChainClient, DevSigner, KmsSigner } from "@mallaka/shared";
import { Networks } from "@stellar/stellar-sdk";
import { KeeperService } from "./keeper.js";

const { Pool } = pg;

export async function startKeeperService() {
  const config = loadConfig();
  const logger = createLogger("keeper");
  const networkPassphrase =
    config.STELLAR_NETWORK === "testnet" ? Networks.TESTNET : Networks.PUBLIC;

  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const chainClient = new ChainClient({
    rpcUrl: config.SOROBAN_RPC_URL,
    logger,
  });

  let keeperSigner = undefined;
  if (config.STELLAR_NETWORK === "testnet" && process.env.KEEPER_SECRET_KEY) {
    keeperSigner = new DevSigner(process.env.KEEPER_SECRET_KEY, "testnet");
  } else if (config.KMS_KEY_ID && config.SPONSOR_PUBLIC_KEY) {
    keeperSigner = new KmsSigner(config.KMS_KEY_ID, config.SPONSOR_PUBLIC_KEY, async () => {
      throw new Error("KMS signing not configured for keeper in local run");
    });
  }

  const keeper = new KeeperService({
    pgPool: pool,
    chainClient,
    leaseContractId: config.LEASE_CONTRACT_ID,
    networkPassphrase,
    keeperSigner,
    logger,
  });

  const intervalSeconds = config.KEEPER_INTERVAL_SECONDS ?? 60;
  logger.info(`Starting keeper scheduled loop with interval ${intervalSeconds}s`);

  return { keeper, pool, intervalSeconds };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startKeeperService()
    .then(({ keeper, intervalSeconds }) => {
      setInterval(() => {
        keeper.scanAndCheckDefaults().catch((err) => {
          // eslint-disable-next-line no-console
          console.error("Keeper scanAndCheckDefaults error:", err);
        });
        keeper.scanAndExtendTtls().catch((err) => {
          // eslint-disable-next-line no-console
          console.error("Keeper scanAndExtendTtls error:", err);
        });
      }, intervalSeconds * 1000);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Keeper startup error:", err);
      process.exit(1);
    });
}

