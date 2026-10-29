import pg from "pg";
import { Networks } from "@stellar/stellar-sdk";
import { loadConfig, createLogger, SorobanLeaseChain, SponsorQueueSubmitter, devKeyResolverFromEnv } from "@mallaka/shared";
import { FixedRateProvider, BullMqPayQueue, PaymentProcessor, createPayWorker, type PayJobQueue } from "@mallaka/payments";
import { Notifier, driverFromConfig } from "@mallaka/notifier";
import { buildApp } from "./app.js";
import { DevCheckout, PaystackCheckout } from "./checkout.js";

/** Wires the real dependencies from env (README 16) and starts listening. */
export async function startApi(port = Number(process.env.PORT ?? 3001)) {
  const config = loadConfig();
  const logger = createLogger("api");
  if (!config.JWT_SECRET) throw new Error("JWT_SECRET is required");
  if (!config.REDIS_URL) throw new Error("REDIS_URL is required (sponsor and payment queues)");

  const db = new pg.Pool({ connectionString: config.DATABASE_URL });
  const chain = new SorobanLeaseChain({
    rpcUrl: config.SOROBAN_RPC_URL,
    networkPassphrase: config.STELLAR_NETWORK === "testnet" ? Networks.TESTNET : Networks.PUBLIC,
    leaseContractId: config.LEASE_CONTRACT_ID,
    keys: devKeyResolverFromEnv(config.STELLAR_NETWORK),
    submitter: new SponsorQueueSubmitter(config.REDIS_URL),
  });
  const notifier = new Notifier({ driver: driverFromConfig(config), db, contactSecret: config.JWT_SECRET });

  const processor = new PaymentProcessor({ db, chain, logger });
  const payQueue: PayJobQueue = new BullMqPayQueue(config.REDIS_URL);
  createPayWorker(config.REDIS_URL, processor);

  const app = await buildApp({
    db,
    chain,
    otp: notifier,
    fx: new FixedRateProvider(),
    payQueue,
    checkout: { paystack: config.PAYSTACK_SECRET_KEY ? new PaystackCheckout(config.PAYSTACK_SECRET_KEY) : new DevCheckout() },
    jwtSecret: config.JWT_SECRET,
    paystackSecretKey: config.PAYSTACK_SECRET_KEY,
    flutterwaveSecretHash: config.FLUTTERWAVE_SECRET_HASH,
    contracts: { titleRegistry: config.TITLE_REGISTRY_CONTRACT_ID ?? "", token: config.PAYMENT_TOKEN_CONTRACT_ID ?? "" },
    manualLockApprovalThreshold: BigInt(config.MANUAL_LOCK_APPROVAL_THRESHOLD ?? "0"),
  });
  await app.listen({ port, host: "0.0.0.0" });
  logger.info("API listening", { port });
  return app;
}
