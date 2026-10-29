import type { Queryable } from "@mallaka/shared";
import { createLogger, type Logger } from "@mallaka/shared";

export type MismatchKind = "missing_on_chain" | "amount_mismatch" | "stuck_unsettled";

export interface Mismatch {
  kind: MismatchKind;
  paymentId: string;
  providerReference: string;
  detail: string;
}

export interface ReconciliationOptions {
  db: Queryable;
  /** Raise an alert (Sentry/pager). Defaults to an error log line with a metric name. */
  alert?: (message: string, details: Record<string, unknown>) => void;
  logger?: Logger;
  now?: () => Date;
  /** Look-back window in hours. Default 24 (daily job). */
  windowHours?: number;
  /** A payment not settled after this many minutes is reported as stuck. Default 60. */
  stuckAfterMinutes?: number;
}

interface PaymentRecord {
  id: string;
  provider_reference: string;
  status: string;
  tx_hash: string | null;
  applied_token_amount: string | null;
  created_at: Date | string;
}

/**
 * Daily reconciliation (README 19): compare what the providers told us (the
 * `payments` rows created from verified webhooks) with the on-chain `payment`
 * events persisted by the indexer in `chain_events`.
 * Every mismatch is written to `audit_log` and raises an alert.
 */
export async function reconcile(opts: ReconciliationOptions): Promise<Mismatch[]> {
  const logger = opts.logger ?? createLogger("payments:reconciliation");
  const alert = opts.alert ?? ((m, d) => logger.error(m, { ...d, metric: "payments_reconciliation_mismatch" }));
  const now = (opts.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - (opts.windowHours ?? 24) * 3600 * 1000).toISOString();
  const stuckCutoff = now.getTime() - (opts.stuckAfterMinutes ?? 60) * 60 * 1000;

  const payments = await opts.db.query<PaymentRecord>(
    `SELECT id, provider_reference, status, tx_hash, applied_token_amount, created_at
     FROM payments WHERE created_at >= $1 ORDER BY created_at;`,
    [since]
  );

  const mismatches: Mismatch[] = [];
  for (const p of payments.rows) {
    if (p.status !== "confirmed") {
      if (new Date(p.created_at).getTime() <= stuckCutoff) {
        mismatches.push({
          kind: "stuck_unsettled",
          paymentId: p.id,
          providerReference: p.provider_reference,
          detail: `Provider payment still ${p.status}; not applied on-chain`,
        });
      }
      continue;
    }
    const applied = BigInt(String(p.applied_token_amount ?? "0"));
    if (applied === 0n) continue; // nothing was due on-chain (whole amount flagged as excess)

    const ev = await opts.db.query<{ data: unknown }>(
      `SELECT data FROM chain_events WHERE event_name = 'payment' AND tx_hash = $1;`,
      [p.tx_hash ?? ""]
    );
    if (ev.rows.length === 0) {
      mismatches.push({
        kind: "missing_on_chain",
        paymentId: p.id,
        providerReference: p.provider_reference,
        detail: `No on-chain payment event for tx ${p.tx_hash ?? "(none)"}`,
      });
      continue;
    }
    const raw = typeof ev.rows[0].data === "string" ? JSON.parse(ev.rows[0].data) : ev.rows[0].data;
    const eventAmount = Array.isArray(raw) ? BigInt(String(raw[0])) : undefined;
    if (eventAmount !== undefined && eventAmount !== applied) {
      mismatches.push({
        kind: "amount_mismatch",
        paymentId: p.id,
        providerReference: p.provider_reference,
        detail: `Applied ${applied} but chain event shows ${eventAmount}`,
      });
    }
  }

  for (const m of mismatches) {
    await opts.db.query(
      `INSERT INTO audit_log (actor, action, resource, details) VALUES ('payments:reconciliation', 'reconciliation_mismatch', $1, $2);`,
      [`payment:${m.paymentId}`, JSON.stringify(m)]
    );
    alert(`Reconciliation mismatch (${m.kind})`, { ...m });
  }
  logger.info("Reconciliation finished", { checked: payments.rows.length, mismatches: mismatches.length });
  return mismatches;
}
