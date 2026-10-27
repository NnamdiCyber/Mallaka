import { Worker, Job } from "bullmq";
import { TransactionBuilder, Transaction } from "@stellar/stellar-sdk";
import { ChainClient, Logger, createLogger, SubmitResult } from "@mallaka/shared";
import { FeeBumpService } from "./fee-bump.js";

export const SPONSOR_TX_QUEUE_NAME = "sponsor-transactions";

export interface SubmitTxJobData {
  txXdr: string;
  skipSimulation?: boolean;
}

export interface SponsorWorkerOptions {
  redisUrl: string;
  networkPassphrase: string;
  feeBumpService: FeeBumpService;
  chainClient: ChainClient;
  logger?: Logger;
  concurrency?: number;
}

export function createSponsorWorker(options: SponsorWorkerOptions): Worker<SubmitTxJobData, SubmitResult> {
  const logger = options.logger ?? createLogger("sponsor:queue-worker");

  const worker = new Worker<SubmitTxJobData, SubmitResult>(
    SPONSOR_TX_QUEUE_NAME,
    async (job: Job<SubmitTxJobData, SubmitResult>) => {
      const { txXdr, skipSimulation } = job.data;
      logger.info(`Processing submission job ${job.id}`);

      // 1. Rehydrate inner transaction
      const innerTx = TransactionBuilder.fromXDR(
        txXdr,
        options.networkPassphrase
      ) as Transaction;

      // 2. Simulate before submitting (ALWAYS simulate discipline)
      if (!skipSimulation) {
        logger.debug("Simulating inner transaction prior to fee-bump", { jobId: job.id });
        await options.chainClient.simulate(innerTx);
      }

      // 3. Wrap in FeeBumpTransaction and sign with sponsor account
      const feeBumpTx = await options.feeBumpService.wrapAndSign(innerTx);

      // 4. Submit fee-bump transaction and poll to finality
      const result = await options.chainClient.submitAndPoll(feeBumpTx, true);

      logger.info(`Job ${job.id} completed successfully`, {
        txHash: result.txHash,
        ledger: result.ledger,
      });

      return result;
    },
    {
      connection: { url: options.redisUrl },
      concurrency: options.concurrency ?? 1,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error(`Job ${job?.id} failed with error: ${err.message}`, {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
