import type { Queryable, LeaseChain, PreparedTx } from "@mallaka/shared";
import { ContractError, createLogger, minBigInt, fromScaled, toScaled, type Logger } from "@mallaka/shared";

/** A prepared transaction expires after TX_VALIDITY_SECONDS (300s). Past this and unseen, it can never land. */
const PREPARED_EXPIRY_SECONDS = 300 + 60;

interface PaymentRow {
  id: string;
  lease_id: string;
  payer_address: string;
  naira_amount: string;
  token_amount: string;
  status: "pending" | "submitted" | "confirmed" | "failed";
  tx_hash: string | null;
  signed_tx_xdr: string | null;
  prepared_at: Date | string | null;
  attempts: number;
  refund_flagged: boolean;
  excess_token_amount: string;
  excess_naira_amount: string;
}

export interface ProcessorOptions {
  db: Queryable;
  chain: LeaseChain;
  /** After this many failed attempts the payment is flagged for manual review and an alert is raised. */
  maxAttempts?: number;
  /** Alert hook (Sentry/pager). Defaults to an error log line. */
  alert?: (message: string, details: Record<string, unknown>) => void;
  logger?: Logger;
  now?: () => Date;
}

export type ProcessResult = "settled" | "failed" | "already_settled" | "not_found";

/**
 * Applies a verified payment on-chain exactly once (README 12 steps 3-4, README 19).
 *
 * Safety properties:
 *  - Settled ONLY after the transaction is final.
 *  - The signed transaction and its hash are persisted BEFORE sending. On any retry we
 *    look the hash up first; an unknown outcome is never answered by building a second
 *    payment while the first could still land.
 *  - Overpayment: only min(token_amount, remaining on chain) is sent. The excess is
 *    flagged for manual refund. We never rely on the contract to keep it.
 */
export class PaymentProcessor {
  private readonly db: Queryable;
  private readonly chain: LeaseChain;
  private readonly maxAttempts: number;
  private readonly logger: Logger;
  private readonly alert: (message: string, details: Record<string, unknown>) => void;
  private readonly now: () => Date;
  private readonly inFlight = new Set<string>();

  constructor(opts: ProcessorOptions) {
    this.db = opts.db;
    this.chain = opts.chain;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.logger = opts.logger ?? createLogger("payments:processor");
    this.alert =
      opts.alert ?? ((message, details) => this.logger.error(message, { ...details, metric: "payments_alert" }));
    this.now = opts.now ?? (() => new Date());
  }

  private async load(id: string): Promise<PaymentRow | undefined> {
    const r = await this.db.query<PaymentRow>(`SELECT * FROM payments WHERE id = $1;`, [id]);
    return r.rows[0];
  }

  async process(paymentId: string): Promise<ProcessResult> {
    // Same-process guard. Cross-process safety comes from the persisted signed tx (same hash).
    if (this.inFlight.has(paymentId)) return "failed";
    this.inFlight.add(paymentId);
    try {
      return await this.run(paymentId);
    } finally {
      this.inFlight.delete(paymentId);
    }
  }

  private async run(paymentId: string): Promise<ProcessResult> {
    let p = await this.load(paymentId);
    if (!p) return "not_found";
    if (p.status === "confirmed") return "already_settled";

    try {
      // 1. Resolve an earlier attempt whose outcome we may not know.
      if (p.signed_tx_xdr && p.tx_hash) {
        const seen = await this.chain.lookup(p.tx_hash);
        if (seen === "SUCCESS") {
          await this.settle(p, p.tx_hash);
          return "settled";
        }
        const expired = this.isExpired(p.prepared_at);
        if (seen === "FAILED" || (seen === "NOT_FOUND" && expired)) {
          // Definitively not applied (failed, or expired and never seen). Safe to rebuild.
          await this.db.query(
            `UPDATE payments SET signed_tx_xdr = NULL, tx_hash = NULL, prepared_at = NULL, updated_at = NOW() WHERE id = $1 AND status <> 'confirmed';`,
            [p.id]
          );
          p = (await this.load(paymentId))!;
        } else {
          // NOT_FOUND but still valid: re-send the SAME signed transaction (same hash, cannot double-apply).
          return await this.send(p, { txHash: p.tx_hash, txXdr: p.signed_tx_xdr });
        }
      }

      // 2. Fresh attempt. Re-read the balance from the chain (never trust the contract to keep excess).
      const snapshot = await this.chain.getSnapshot(String(p.lease_id));
      const total = BigInt(String(p.token_amount));
      const remaining = BigInt(snapshot.remainingBalance);
      const applied = minBigInt(total, remaining);
      const excess = total - applied;
      await this.recordSplit(p, applied, excess);

      if (applied === 0n) {
        // Nothing can be applied (lease already paid off). Whole amount is excess awaiting manual refund.
        await this.settle(p, null);
        return "settled";
      }

      const prepared = await this.chain.prepare({
        kind: "pay",
        leaseId: String(p.lease_id),
        payer: p.payer_address,
        amount: applied.toString(),
      });
      // Persist BEFORE sending. Compare-and-set: if another worker prepared first, use theirs.
      const claimed = await this.db.query(
        `UPDATE payments SET signed_tx_xdr = $1, tx_hash = $2, prepared_at = $3, updated_at = NOW()
         WHERE id = $4 AND signed_tx_xdr IS NULL AND status <> 'confirmed';`,
        [prepared.txXdr, prepared.txHash, this.now().toISOString(), p.id]
      );
      if (!claimed.rowCount) {
        const reloaded = (await this.load(paymentId))!;
        if (reloaded.status === "confirmed") return "already_settled";
        return await this.send(reloaded, { txHash: reloaded.tx_hash!, txXdr: reloaded.signed_tx_xdr! });
      }
      return await this.send({ ...p, tx_hash: prepared.txHash }, prepared);
    } catch (err) {
      await this.recordFailure(paymentId, err);
      return "failed";
    }
  }

  private isExpired(preparedAt: Date | string | null): boolean {
    if (!preparedAt) return true;
    const ageSeconds = (this.now().getTime() - new Date(preparedAt).getTime()) / 1000;
    return ageSeconds > PREPARED_EXPIRY_SECONDS;
  }

  private async send(p: PaymentRow, prepared: PreparedTx): Promise<ProcessResult> {
    await this.db.query(`UPDATE payments SET status = 'submitted', updated_at = NOW() WHERE id = $1 AND status <> 'confirmed';`, [p.id]);
    try {
      const outcome = await this.chain.submit(prepared);
      await this.settle(p, outcome.txHash ?? prepared.txHash);
      return "settled";
    } catch (err) {
      // Includes ContractError (e.g. Overpayment race) and transient RPC failures.
      // The signed tx stays recorded; the next retry looks its hash up before doing anything.
      await this.recordFailure(p.id, err);
      return "failed";
    }
  }

  private async recordSplit(p: PaymentRow, applied: bigint, excess: bigint): Promise<void> {
    const nairaKobo = toScaled(String(p.naira_amount), 2);
    const total = BigInt(String(p.token_amount));
    const excessKobo = total === 0n ? 0n : (nairaKobo * excess) / total;
    await this.db.query(
      `UPDATE payments SET applied_token_amount = $1, excess_token_amount = $2, excess_naira_amount = $3,
         refund_flagged = $4, updated_at = NOW() WHERE id = $5 AND status <> 'confirmed';`,
      [applied.toString(), excess.toString(), fromScaled(excessKobo, 2), excess > 0n, p.id]
    );
  }

  /** Marks the payment settled. Only called once the transaction is final (or nothing needed applying). */
  private async settle(p: PaymentRow, txHash: string | null): Promise<void> {
    const res = await this.db.query(
      `UPDATE payments SET status = 'confirmed', tx_hash = $1, settled_at = NOW(), last_error = NULL, updated_at = NOW()
       WHERE id = $2 AND status <> 'confirmed';`,
      [txHash, p.id]
    );
    if (!res.rowCount) return;
    const fresh = (await this.load(p.id))!;
    if (fresh.refund_flagged) {
      await this.db.query(
        `INSERT INTO audit_log (actor, action, resource, details) VALUES ('payments:processor', 'overpayment_excess_flagged', $1, $2);`,
        [
          `payment:${p.id}`,
          JSON.stringify({
            lease_id: p.lease_id,
            excess_token_amount: String(fresh.excess_token_amount),
            excess_naira_amount: String(fresh.excess_naira_amount),
            note: "Excess is NOT applied on-chain. Manual refund required.",
          }),
        ]
      );
      this.alert("Overpayment excess flagged for manual refund", { paymentId: p.id });
    }
    this.logger.info("Payment settled", { paymentId: p.id, txHash });
  }

  private async recordFailure(paymentId: string, err: unknown): Promise<void> {
    const message = err instanceof ContractError ? `${err.contractErrorName}: ${err.message}` : (err as Error).message;
    const res = await this.db.query<{ attempts: number }>(
      `UPDATE payments SET status = 'failed', last_error = $1, attempts = attempts + 1, updated_at = NOW()
       WHERE id = $2 AND status <> 'confirmed' RETURNING attempts;`,
      [message.slice(0, 500), paymentId]
    );
    const attempts = Number(res.rows[0]?.attempts ?? 0);
    this.logger.warn("Payment attempt failed; remains retryable", { paymentId, attempts, error: message });
    if (attempts >= this.maxAttempts) {
      await this.db.query(`UPDATE payments SET needs_review = TRUE, updated_at = NOW() WHERE id = $1;`, [paymentId]);
      await this.db.query(
        `INSERT INTO audit_log (actor, action, resource, details) VALUES ('payments:processor', 'payment_needs_review', $1, $2);`,
        [`payment:${paymentId}`, JSON.stringify({ attempts, lastError: message })]
      );
      this.alert("Payment exceeded max attempts and needs manual review", { paymentId, attempts });
    }
  }

  /**
   * Sweeper: re-processes everything not settled and not parked for review.
   * Run on a timer so a lost job or a crash between "recorded" and "enqueued" never loses a payment.
   */
  async retryDue(minAgeSeconds = 30): Promise<number> {
    const cutoff = new Date(this.now().getTime() - minAgeSeconds * 1000).toISOString();
    const due = await this.db.query<{ id: string }>(
      `SELECT id FROM payments WHERE status IN ('pending', 'failed', 'submitted') AND needs_review = FALSE AND updated_at <= $1 ORDER BY created_at;`,
      [cutoff]
    );
    let settled = 0;
    for (const row of due.rows) {
      if ((await this.process(row.id)) === "settled") settled++;
    }
    return settled;
  }
}
