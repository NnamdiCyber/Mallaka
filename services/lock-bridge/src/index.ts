export * from "./device.js";
export * from "./bridge.js";

import pg from "pg";
import { Worker } from "bullmq";
import { Networks } from "@stellar/stellar-sdk";
import { loadConfig, createLogger, SorobanLeaseChain, devKeyResolverFromEnv } from "@mallaka/shared";
import { Notifier, driverFromConfig } from "@mallaka/notifier";
import { ManualDriver, VendorHttpDriver, type DeviceAdapter } from "./device.js";
import { LockBridge, type LockJob } from "./bridge.js";

/** Picks the device driver: vendor HTTP if configured, otherwise manual (Phase 1). MQTT is wired by injecting an MqttDriver. */
export function deviceFromConfig(config: { LOCK_VENDOR_API_URL?: string; LOCK_VENDOR_API_KEY?: string }): DeviceAdapter {
  if (config.LOCK_VENDOR_API_URL && config.LOCK_VENDOR_API_KEY) {
    return new VendorHttpDriver({ baseUrl: config.LOCK_VENDOR_API_URL, apiKey: config.LOCK_VENDOR_API_KEY });
  }
  return new ManualDriver();
}

export async function startLockBridgeService() {
  const config = loadConfig();
  const logger = createLogger("lock-bridge");
  const db = new pg.Pool({ connectionString: config.DATABASE_URL });
  // Read-only use: this service never submits transactions, so it has no submitter or signing keys.
  const chain = new SorobanLeaseChain({
    rpcUrl: config.SOROBAN_RPC_URL,
    networkPassphrase: config.STELLAR_NETWORK === "testnet" ? Networks.TESTNET : Networks.PUBLIC,
    leaseContractId: config.LEASE_CONTRACT_ID,
    keys: devKeyResolverFromEnv(config.STELLAR_NETWORK),
    submitter: { submit: () => Promise.reject(new Error("lock-bridge never submits transactions")) },
  });
  const notifier = new Notifier({ driver: driverFromConfig(config), db, contactSecret: config.JWT_SECRET ?? "default_local_dev_secret_key_32chars!" });
  const bridge = new LockBridge({ db, chain, device: deviceFromConfig(config), notifier, logger });

  let worker: Worker | undefined;
  if (config.REDIS_URL) {
    worker = new Worker("lock-commands", async (job) => void (await bridge.handleJob(job.data as LockJob)), {
      connection: { url: config.REDIS_URL },
    });
  }
  setInterval(() => void bridge.processQueued().catch((e) => logger.error("sweep failed", { error: String(e) })), 30_000);
  logger.info("Lock bridge running", { driver: deviceFromConfig(config).name });
  return { bridge, worker };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startLockBridgeService().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
