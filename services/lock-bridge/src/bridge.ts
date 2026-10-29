import { createLogger, type LeaseChain, type LeaseSnapshot, type Logger, type Queryable } from "@mallaka/shared";
import { formatDate, tokenToNairaText, type NoticeKind } from "@mallaka/notifier";
import type { DeviceAdapter } from "./device.js";

/** The slice of the notifier the bridge needs. Satisfied by `Notifier`. */
export interface RiderNotifier {
  hasNotice(leaseId: string, kind: NoticeKind): Promise<boolean>;
  notifyLease(leaseId: string, id: "pre_lock" | "lock_engaged" | "unlock_confirmed" | "lease_completed", params?: Record<string, string>): Promise<boolean>;
}

export interface BridgeOptions {
  db: Queryable;
  chain: LeaseChain;
  device: DeviceAdapter;
  notifier: RiderNotifier;
  /** Seconds between the pre-lock notice and the earliest lock. Default 24h. */
  preLockDelaySeconds?: number;
  /** Seconds before a deferred lock (moving vehicle, device offline, ...) is retried. Default 5 min. */
  retryDelaySeconds?: number;
  /** Quick inline attempts for an unlock before leaving it queued for the sweeper. Default 3. */
  unlockInlineAttempts?: number;
  /** Naira per token used only to show an approximate amount in messages. */
  nairaPerToken?: string;
  now?: () => Date;
  logger?: Logger;
}

export type Outcome = "acknowledged" | "sent" | "deferred" | "refused" | "fail_open" | "failed" | "superseded";

/** Job shape produced by the indexer's fan-out to the "lock-commands" queue. */
export interface LockJob {
  eventName: string;
  leaseId?: string;
  txHash?: string;
}

interface CommandRow {
  id: string;
  lease_id: string | number;
  asset_id: string;
  device_id: string;
  command: "lock" | "unlock";
  triggered_by: string;
  status: "queued" | "sent" | "acknowledged" | "failed";
  result_details: Record<string, unknown> | string | null;
  created_at: Date | string;
}

const parseDetails = (d: CommandRow["result_details"]): Record<string, unknown> =>
  typeof d === "string" ? JSON.parse(d) : (d ?? {});

/**
 * The lock bridge (README 11). The lock is a CONSEQUENCE of contract state, never a source of it.
 *
 * Before EVERY command the lease is re-read from the chain. Safety rules, each enforced below:
 *  1. Never immobilize a moving vehicle (defer to the next stop).
 *  2. Notify first: Grace-entry and pre-lock notices must exist before a lock.
 *  3. Unlock on cured/completed is immediate and retried until acknowledged.
 *  4. FAIL OPEN: if chain state cannot be confirmed, do NOT lock.
 *  5. Every command is recorded in lock_commands with trigger, timestamp and result.
 */
export class LockBridge {
  private readonly o: Required<Pick<BridgeOptions, "preLockDelaySeconds" | "retryDelaySeconds" | "unlockInlineAttempts" | "nairaPerToken">> & BridgeOptions;
  private readonly logger: Logger;

  constructor(opts: BridgeOptions) {
    this.o = {
      preLockDelaySeconds: 86_400,
      retryDelaySeconds: 300,
      unlockInlineAttempts: 3,
      nairaPerToken: "1500.000000",
      ...opts,
    };
    this.logger = opts.logger ?? createLogger("lock-bridge");
  }

  private now(): Date {
    return (this.o.now ?? (() => new Date()))();
  }

  /** Entry point for indexer jobs: defaulted, cured, completed, repossessed. */
  async handleJob(job: LockJob): Promise<Outcome | "ignored"> {
    if (!job.leaseId) return "ignored";
    const trigger = `event:${job.eventName}${job.txHash ? `:${job.txHash}` : ""}`;
    switch (job.eventName) {
      case "defaulted":
        return this.enqueueAndRun(job.leaseId, "lock", trigger);
      case "cured":
        return this.enqueueAndRun(job.leaseId, "unlock", trigger);
      case "completed": {
        const out = await this.enqueueAndRun(job.leaseId, "unlock", trigger);
        await this.o.notifier.notifyLease(job.leaseId, "lease_completed").catch(() => false);
        return out;
      }
      case "repossessed":
        // Lock state is "n/a" after repossession (README 6): the lessor holds the asset.
        // Pending automated locks are cancelled and no device command is sent.
        await this.cancelPendingLocks(job.leaseId, "repossessed");
        this.logger.info("Repossessed event consumed; no device command", { leaseId: job.leaseId });
        return "ignored";
      default:
        return "ignored";
    }
  }

  private async enqueueAndRun(leaseId: string, command: "lock" | "unlock", trigger: string): Promise<Outcome> {
    if (command === "unlock") await this.cancelPendingLocks(leaseId, "superseded by unlock");
    // Idempotent per trigger: the same event delivered twice reuses the first row.
    const existing = await this.o.db.query<{ id: string }>(
      `SELECT id FROM lock_commands WHERE lease_id = $1 AND command = $2 AND triggered_by = $3 LIMIT 1;`,
      [leaseId, command, trigger]
    );
    let id = existing.rows[0]?.id;
    if (!id) {
      const dev = await this.o.db.query<{ asset_id: string; device_id: string }>(
        `SELECT l.asset_id, a.device_id FROM leases l JOIN assets a ON a.id = l.asset_id WHERE l.id = $1;`,
        [leaseId]
      );
      if (!dev.rows[0]) return "failed";
      const ins = await this.o.db.query<{ id: string }>(
        `INSERT INTO lock_commands (lease_id, asset_id, device_id, command, triggered_by, status, result_details)
         VALUES ($1, $2, $3, $4, $5, 'queued', $6) RETURNING id;`,
        [leaseId, dev.rows[0].asset_id, dev.rows[0].device_id, command, trigger, JSON.stringify({ source: "automated" })]
      );
      id = ins.rows[0].id;
    }
    return this.execute(id);
  }

  private async cancelPendingLocks(leaseId: string, reason: string): Promise<void> {
    const pending = await this.o.db.query<CommandRow>(
      `SELECT * FROM lock_commands WHERE lease_id = $1 AND command = 'lock' AND status = 'queued';`,
      [leaseId]
    );
    for (const row of pending.rows) await this.finish(row, "failed", { outcome: "superseded", reason });
  }

  private async finish(row: CommandRow, status: CommandRow["status"], patch: Record<string, unknown>): Promise<void> {
    const merged = { ...parseDetails(row.result_details), ...patch, lastAttemptAt: this.now().toISOString() };
    row.result_details = merged;
    row.status = status;
    await this.o.db.query(`UPDATE lock_commands SET status = $1, result_details = $2 WHERE id = $3;`, [
      status,
      JSON.stringify(merged),
      row.id,
    ]);
  }

  private defer(row: CommandRow, reason: string, extra: Record<string, unknown> = {}, delaySeconds = this.o.retryDelaySeconds): Promise<void> {
    const next = new Date(this.now().getTime() + delaySeconds * 1000).toISOString();
    return this.finish(row, "queued", { outcome: "deferred", reason, nextAttemptAt: next, ...extra });
  }

  /** Re-runs every queued command that is due. Run on a timer; also picks up manual commands from the API. */
  async processQueued(): Promise<number> {
    const rows = await this.o.db.query<CommandRow>(`SELECT * FROM lock_commands WHERE status = 'queued' ORDER BY created_at;`);
    let handled = 0;
    for (const row of rows.rows) {
      const next = parseDetails(row.result_details).nextAttemptAt;
      if (typeof next === "string" && new Date(next).getTime() > this.now().getTime()) continue;
      await this.execute(row.id);
      handled++;
    }
    return handled;
  }

  /** Runs one command through every check. Safe to call repeatedly. */
  async execute(commandId: string): Promise<Outcome> {
    const found = await this.o.db.query<CommandRow>(`SELECT * FROM lock_commands WHERE id = $1;`, [commandId]);
    const row = found.rows[0];
    if (!row) return "failed";
    if (row.status !== "queued") return row.status === "acknowledged" ? "acknowledged" : "sent";
    return row.command === "lock" ? this.executeLock(row) : this.executeUnlock(row);
  }

  private async arrearsText(snap: LeaseSnapshot): Promise<string> {
    return tokenToNairaText(BigInt(snap.arrears), this.o.nairaPerToken);
  }

  private async executeLock(row: CommandRow): Promise<Outcome> {
    const leaseId = String(row.lease_id);

    // RULE: re-read the chain before every command. RULE: FAIL OPEN.
    let snap: LeaseSnapshot;
    try {
      snap = await this.o.chain.getSnapshot(leaseId);
    } catch (err) {
      await this.defer(row, "chain_unavailable", { error: (err as Error).message, failOpen: true });
      this.logger.warn("FAIL OPEN: chain unreadable, not locking", { leaseId });
      return "fail_open";
    }
    if (snap.derivedStatus !== "Defaulted") {
      await this.finish(row, "failed", { outcome: "refused", reason: "chain_state_not_defaulted", chainStatus: snap.derivedStatus });
      return "refused";
    }

    // RULE: notify first. Grace-entry notice AND a pre-lock notice (with a waiting period) must exist.
    if (!(await this.o.notifier.hasNotice(leaseId, "grace_entered"))) {
      await this.defer(row, "grace_notice_missing");
      return "deferred";
    }
    const pre = await this.o.db.query<{ created_at: Date | string }>(
      `SELECT created_at FROM rider_notices WHERE lease_id = $1 AND kind = 'pre_lock' ORDER BY created_at LIMIT 1;`,
      [leaseId]
    );
    if (!pre.rows[0]) {
      const lockAfter = new Date(this.now().getTime() + this.o.preLockDelaySeconds * 1000);
      const sent = await this.o.notifier
        .notifyLease(leaseId, "pre_lock", { lockAfter: formatDate(Math.floor(lockAfter.getTime() / 1000)), amount: await this.arrearsText(snap) })
        .catch(() => false);
      await this.defer(row, sent ? "pre_lock_notice_sent" : "pre_lock_notice_failed", {}, sent ? Math.max(this.o.preLockDelaySeconds, 1) : this.o.retryDelaySeconds);
      return "deferred";
    }
    const earliest = new Date(pre.rows[0].created_at).getTime() + this.o.preLockDelaySeconds * 1000;
    if (this.now().getTime() < earliest) {
      await this.defer(row, "pre_lock_waiting_period", {}, Math.ceil((earliest - this.now().getTime()) / 1000));
      return "deferred";
    }

    // RULE: never immobilize a moving vehicle. Only stationary AND engine off; otherwise wait for the next stop.
    if (this.o.device.reportsState) {
      let state;
      try {
        state = await this.o.device.getState(row.device_id);
      } catch (err) {
        await this.defer(row, "device_state_unavailable", { error: (err as Error).message });
        return "deferred";
      }
      if (!state.reachable) {
        await this.defer(row, "device_unreachable");
        return "deferred";
      }
      if (!state.stationary || !state.engineOff) {
        await this.defer(row, "vehicle_in_use_waiting_for_next_stop", { stationary: state.stationary, engineOff: state.engineOff });
        return "deferred";
      }
    }

    try {
      const res = await this.o.device.send({ deviceId: row.device_id, command: "lock", commandId: row.id });
      await this.finish(row, res.acknowledged ? "acknowledged" : "sent", { outcome: res.acknowledged ? "acknowledged" : "sent", driver: this.o.device.name, ...(res.detail ?? {}) });
      if (res.acknowledged) {
        await this.o.notifier.notifyLease(leaseId, "lock_engaged", { amount: await this.arrearsText(snap) }).catch(() => false);
      }
      return res.acknowledged ? "acknowledged" : "sent";
    } catch (err) {
      // A failed lock is never retried blindly: the next attempt must re-pass every check above.
      await this.finish(row, "failed", { outcome: "failed", driver: this.o.device.name, error: (err as Error).message });
      return "failed";
    }
  }

  private async executeUnlock(row: CommandRow): Promise<Outcome> {
    const leaseId = String(row.lease_id);
    const manual = row.triggered_by.startsWith("lessor_staff:") || row.triggered_by.startsWith("admin:");

    // Re-read the chain. If it still says Defaulted, an AUTOMATED unlock is not justified.
    // If the chain is unreadable we still release: unlocking is the safe direction.
    let chainConfirmed = true;
    try {
      const snap = await this.o.chain.getSnapshot(leaseId);
      if (snap.derivedStatus === "Defaulted" && !manual) {
        await this.finish(row, "failed", { outcome: "refused", reason: "chain_state_still_defaulted" });
        return "refused";
      }
    } catch {
      chainConfirmed = false;
    }

    // Immediate, and retried until acknowledged (a few inline tries, then the sweeper keeps trying).
    const attempts = Number(parseDetails(row.result_details).attempts ?? 0);
    for (let i = 0; i < this.o.unlockInlineAttempts; i++) {
      const n = attempts + i + 1;
      try {
        const res = await this.o.device.send({ deviceId: row.device_id, command: "unlock", commandId: row.id });
        if (res.acknowledged) {
          await this.finish(row, "acknowledged", { outcome: "acknowledged", attempts: n, chainConfirmed, driver: this.o.device.name });
          await this.o.notifier.notifyLease(leaseId, "unlock_confirmed").catch(() => false);
          return "acknowledged";
        }
        if (!this.o.device.reportsState) {
          // Manual driver: intent recorded for a human, nothing more to retry here.
          await this.finish(row, "sent", { outcome: "sent", attempts: n, chainConfirmed, driver: this.o.device.name, ...(res.detail ?? {}) });
          return "sent";
        }
        await this.finish(row, "queued", { outcome: "awaiting_ack", attempts: n, chainConfirmed });
      } catch (err) {
        await this.finish(row, "queued", { outcome: "send_failed", attempts: n, chainConfirmed, error: (err as Error).message });
      }
    }
    // Still queued with no nextAttemptAt: the sweeper retries immediately, until acknowledged.
    this.logger.warn("Unlock not yet acknowledged; will keep retrying", { leaseId, commandId: row.id });
    return "deferred";
  }
}
