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
