import { Queue, Worker } from "bullmq";
import type { PayJobQueue } from "./queue.js";
import type { PaymentProcessor } from "./processor.js";

export const PAY_QUEUE_NAME = "payments-pay";

/** BullMQ-backed queue. jobId = payment id, so enqueueing the same payment twice is a no-op. */
export class BullMqPayQueue implements PayJobQueue {
  private readonly queue: Queue;
  constructor(redisUrl: string) {
    this.queue = new Queue(PAY_QUEUE_NAME, { connection: { url: redisUrl } });
  }
  async enqueue(paymentId: string): Promise<void> {
    await this.queue.add("pay", { paymentId }, { jobId: paymentId, removeOnComplete: true });
  }
  close(): Promise<void> {
    return this.queue.close();
  }
}

export function createPayWorker(redisUrl: string, processor: PaymentProcessor): Worker {
  return new Worker(
    PAY_QUEUE_NAME,
    async (job) => {
      await processor.process((job.data as { paymentId: string }).paymentId);
    },
    { connection: { url: redisUrl }, concurrency: 1 }
  );
}
