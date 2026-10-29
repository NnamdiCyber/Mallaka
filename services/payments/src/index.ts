export * from "./fx.js";
export * from "./signature.js";
export * from "./providers.js";
export * from "./queue.js";
export * from "./processor.js";
export * from "./webhook.js";
export * from "./routes.js";
export * from "./reconciliation.js";
export * from "./bull-queue.js";

import Fastify from "fastify";
import pg from "pg";
import { Networks } from "@stellar/stellar-sdk";
import {
  loadConfig,
  createLogger,
  SorobanLeaseChain,
  SponsorQueueSubmitter,
  devKeyResolverFromEnv,
} from "@mallaka/shared";
import { FixedRateProvider } from "./fx.js";
import { InlineQueue } from "./queue.js";
import { BullMqPayQueue, createPayWorker } from "./bull-queue.js";
import { PaymentProcessor } from "./processor.js";
import { paymentWebhookRoutes } from "./routes.js";
import { reconcile } from "./reconciliation.js";

/** Standalone entry point (README 9 allows mounting via api OR standalone). */
export async function startPaymentsService(port = Number(process.env.PAYMENTS_PORT ?? 3002)) {
  const config = loadConfig();
  const logger = createLogger("payments");
  const db = new pg.Pool({ connectionString: config.DATABASE_URL });
  const networkPassphrase = config.STELLAR_NETWORK === "testnet" ? Networks.TESTNET : Networks.PUBLIC;

  if (!config.REDIS_URL) throw new Error("REDIS_URL is required to submit on-chain payments through the sponsor");
  const chain = new SorobanLeaseChain({
    rpcUrl: config.SOROBAN_RPC_URL,
    networkPassphrase,
    leaseContractId: config.LEASE_CONTRACT_ID,
    keys: devKeyResolverFromEnv(config.STELLAR_NETWORK),
    submitter: new SponsorQueueSubmitter(config.REDIS_URL),
  });
  const processor = new PaymentProcessor({ db, chain, logger });

  const queue = config.REDIS_URL ? new BullMqPayQueue(config.REDIS_URL) : new InlineQueue();
  if (config.REDIS_URL) createPayWorker(config.REDIS_URL, processor);
  else (queue as InlineQueue).setHandler((id) => processor.process(id));

  const app = Fastify({ logger: false });
  await app.register(paymentWebhookRoutes, {
    db,
    fx: new FixedRateProvider(),
    queue,
    paystackSecretKey: config.PAYSTACK_SECRET_KEY,
    flutterwaveSecretHash: config.FLUTTERWAVE_SECRET_HASH,
    logger,
  });
  await app.listen({ port, host: "0.0.0.0" });

  // Retry sweeper (every minute) and daily reconciliation.
  setInterval(() => void processor.retryDue().catch((e) => logger.error("retry sweep failed", { error: String(e) })), 60_000);
  setInterval(() => void reconcile({ db, logger }).catch((e) => logger.error("reconciliation failed", { error: String(e) })), 24 * 3600 * 1000);
  logger.info("Payments service listening", { port, networkPassphrase });
  return { app, processor };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startPaymentsService().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
