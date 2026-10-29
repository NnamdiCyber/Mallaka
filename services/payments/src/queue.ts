/**
 * The durable record of a pending payment is the `payments` row itself, so a
 * lost job never loses money: `PaymentProcessor.retryDue` re-queues anything not settled.
 */
export interface PayJobQueue {
  enqueue(paymentId: string): Promise<void>;
}

/** Runs the job in-process (dev and tests). Errors are swallowed because the row stays retryable. */
export class InlineQueue implements PayJobQueue {
  private handler?: (paymentId: string) => Promise<unknown>;
  setHandler(handler: (paymentId: string) => Promise<unknown>): void {
    this.handler = handler;
  }
  async enqueue(paymentId: string): Promise<void> {
    try {
      await this.handler?.(paymentId);
    } catch {
      /* the processor already recorded the failure on the payment row */
    }
  }
}

/** Collects job ids without running them. Used by tests that drive the processor by hand. */
export class ManualQueue implements PayJobQueue {
  readonly jobs: string[] = [];
  async enqueue(paymentId: string): Promise<void> {
    this.jobs.push(paymentId);
  }
}
