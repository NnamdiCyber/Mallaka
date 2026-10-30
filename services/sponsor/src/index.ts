export * from "./fee-bump.js";
export * from "./balance-monitor.js";
export * from "./queue-worker.js";

import {
  loadConfig,
  createLogger,
  ChainClient,
  DevSigner,
  KmsSigner,
  Signer,
} from "@mallaka/shared";
import { Networks } from "@stellar/stellar-sdk";
import { FeeBumpService } from "./fee-bump.js";
import { BalanceMonitor } from "./balance-monitor.js";
import { createSponsorWorker } from "./queue-worker.js";

export function initSponsorSigner(): Signer {
  const config = loadConfig();
  if (config.STELLAR_NETWORK === "testnet") {
    const seed = process.env.SPONSOR_SECRET_KEY || "SDUMMYSECRETFORTESTNETINITIALIZATION00000000000000000";
    return new DevSigner(seed, "testnet");
  }

  if (!config.KMS_KEY_ID || !config.SPONSOR_PUBLIC_KEY) {
    throw new Error("Mainnet requires KMS_KEY_ID and SPONSOR_PUBLIC_KEY configured");
  }

  return new KmsSigner(config.KMS_KEY_ID, config.SPONSOR_PUBLIC_KEY, async () => {
    throw new Error("Production KMS signing provider not attached in current environment");
  });
}

export async function startSponsorService() {
  const config = loadConfig();
  const logger = createLogger("sponsor");
  const networkPassphrase =
    config.STELLAR_NETWORK === "testnet" ? Networks.TESTNET : Networks.PUBLIC;

  const signer = initSponsorSigner();
  const chainClient = new ChainClient({
    rpcUrl: config.SOROBAN_RPC_URL,
    logger,
  });

  const feeBumpService = new FeeBumpService({
    sponsorSigner: signer,
    networkPassphrase,
    logger,
  });

  const sponsorPubKey = await signer.getPublicKey();
  const balanceMonitor = new BalanceMonitor({
    sponsorPublicKey: sponsorPubKey,
    minBalanceThreshold: config.SPONSOR_MIN_BALANCE ?? 100,
    getBalanceFn: async () => 1000, // Default query fallback
    logger,
  });

  // Run initial balance check
  await balanceMonitor.checkBalance();

  if (config.REDIS_URL) {
    const worker = createSponsorWorker({
      redisUrl: config.REDIS_URL,
      networkPassphrase,
      feeBumpService,
      chainClient,
      logger,
    });
    logger.info("Sponsor queue worker listening for transactions");
    return { worker, feeBumpService, balanceMonitor, chainClient };
  }

  return { feeBumpService, balanceMonitor, chainClient };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startSponsorService().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Sponsor service error:", err);
    process.exit(1);
  });
}

