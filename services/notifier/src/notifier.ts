import {
  createLogger,
  decryptContactInfo,
  fromScaled,
  toScaled,
  TOKEN_DECIMALS,
  type Logger,
  type Queryable,
} from "@mallaka/shared";
import { render, isLocale } from "./templates.js";
import type { Locale, NotificationDriver, TemplateId, TemplateParams } from "./types.js";

/** Notice kinds the lock bridge requires before it may lock (README 11 "Notify first"). */
export type NoticeKind = "grace_entered" | "pre_lock";

export interface NotifierOptions {
  driver: NotificationDriver;
  /** Needed for lease-based notifications (rider lookup, notice records). */
  db?: Queryable;
  /** Secret used to decrypt contact info at rest (the same JWT_SECRET the API uses). */
  contactSecret?: string;
  /**
   * Naira per token used ONLY to show approximate naira amounts in messages when a lease
   * has no payment yet. The FX policy itself is an open question (README 22 item 7).
   */
  fallbackNairaPerToken?: string;
  logger?: Logger;
}

interface RiderContact {
  phone: string;
  locale: Locale;
}

/** "N15,000" style naira text from token base units and a rate (naira per token). */
export function tokenToNairaText(tokenUnits: bigint, nairaPerToken: string): string {
  const rateMicro = toScaled(nairaPerToken, 6);
  const kobo = (tokenUnits * rateMicro * 100n) / (10n ** BigInt(TOKEN_DECIMALS) * 1_000_000n);
  const [whole, frac] = fromScaled(kobo, 2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === "00" ? grouped : `${grouped}.${frac}`;
}

/** "30 Oct 2026" (UTC). Dates only, no times, to keep messages short. */
export function formatDate(unixSeconds: number | bigint): string {
  const d = new Date(Number(unixSeconds) * 1000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Channel-agnostic notifier. Messages contain only amounts and dates:
 * never names, phone numbers, ID numbers or addresses.
 */
export class Notifier {
  private readonly driver: NotificationDriver;
  private readonly db?: Queryable;
  private readonly secret?: string;
  private readonly fallbackRate: string;
  private readonly logger: Logger;

  constructor(opts: NotifierOptions) {
    this.driver = opts.driver;
    this.db = opts.db;
    this.secret = opts.contactSecret;
    this.fallbackRate = opts.fallbackNairaPerToken ?? "1500.000000";
    this.logger = opts.logger ?? createLogger("notifier");
  }

  /** Renders and sends one message to a phone number. */
  async send(to: string, id: TemplateId, params: TemplateParams = {}, locale: Locale = "en"): Promise<void> {
    await this.driver.send(to, render(id, locale, params));
  }

  /** Login codes use the same abstraction, so dev uses the console driver. */
  sendOtp(phone: string, code: string): Promise<void> {
    return this.send(phone, "otp", { code });
  }

  private async rider(leaseId: string): Promise<RiderContact | undefined> {
    if (!this.db || !this.secret) return undefined;
    const r = await this.db.query<{ contact_info_encrypted: string }>(
      `SELECT u.contact_info_encrypted FROM leases l JOIN users u ON u.id = l.lessee_id WHERE l.id = $1;`,
      [leaseId]
    );
    if (!r.rows[0]) return undefined;
    const info = decryptContactInfo<{ phone?: string; locale?: string }>(r.rows[0].contact_info_encrypted, this.secret);
    if (!info.phone) return undefined;
    return { phone: info.phone, locale: info.locale && isLocale(info.locale) ? info.locale : "en" };
  }

  /** Latest FX rate used on a payment for this lease, else the fallback. Display only. */
  private async rate(leaseId: string): Promise<string> {
    if (!this.db) return this.fallbackRate;
    const r = await this.db.query<{ fx_rate: string }>(
      `SELECT fx_rate FROM payments WHERE lease_id = $1 ORDER BY created_at DESC LIMIT 1;`,
      [leaseId]
    );
    return r.rows[0] ? String(r.rows[0].fx_rate) : this.fallbackRate;
  }

  /** True once the rider has been told (recorded in rider_notices). */
  async hasNotice(leaseId: string, kind: NoticeKind): Promise<boolean> {
    if (!this.db) return false;
    const r = await this.db.query(`SELECT id FROM rider_notices WHERE lease_id = $1 AND kind = $2 LIMIT 1;`, [leaseId, kind]);
    return r.rows.length > 0;
  }

  /**
   * Sends a templated message to a lease's rider. Returns false (and sends nothing)
   * if the rider cannot be reached. Grace and pre-lock notices are recorded only
   * AFTER a successful send, so a recorded notice means the rider really was told.
   */
  async notifyLease(leaseId: string, id: TemplateId, params: TemplateParams = {}): Promise<boolean> {
    const rider = await this.rider(leaseId);
    if (!rider) {
      this.logger.warn("No reachable rider contact for lease", { leaseId, template: id });
      return false;
    }
    await this.driver.send(rider.phone, render(id, rider.locale, params));
    if ((id === "grace_entered" || id === "pre_lock") && this.db) {
      await this.db.query(`INSERT INTO rider_notices (lease_id, kind, channel) VALUES ($1, $2, $3);`, [
        leaseId,
        id,
        this.driver.name,
      ]);
    }
    return true;
  }

  /** Consumer for the indexer's "notifications" queue (grace_entered, payment). */
  async handleEvent(job: { eventName: string; leaseId?: string; data?: unknown }): Promise<boolean> {
    if (!job.leaseId || !this.db) return false;
    const data = Array.isArray(job.data) ? job.data : [];
    const lease = await this.db.query<{ total_price: string; deposit: string; installment: string }>(
      `SELECT total_price, deposit, installment FROM leases WHERE id = $1;`,
      [job.leaseId]
    );
    const l = lease.rows[0];
    if (!l) return false;
    const rate = await this.rate(job.leaseId);

    if (job.eventName === "grace_entered") {
      // data: [due_ts, grace_ends]
      return this.notifyLease(job.leaseId, "grace_entered", {
        amount: tokenToNairaText(BigInt(String(l.installment)), rate),
        dueDate: formatDate(BigInt(String(data[0]))),
        graceEnds: formatDate(BigInt(String(data[1]))),
      });
    }
    if (job.eventName === "payment") {
      // data: [amount, paid_total, next_due]
      const remaining = BigInt(String(l.total_price)) - BigInt(String(l.deposit)) - BigInt(String(data[1]));
      return this.notifyLease(job.leaseId, "payment_received", {
        amount: tokenToNairaText(BigInt(String(data[0])), rate),
        balance: tokenToNairaText(remaining < 0n ? 0n : remaining, rate),
      });
    }
    return false;
  }

  /**
   * Due-soon reminders (README 9). Sends once per installment for active leases whose next
   * installment is due within `windowSeconds`. next_due = start_ts + (covered + 1) * interval.
   */
  async sendDueSoonReminders(nowUnix: number, windowSeconds = 86400): Promise<number> {
    if (!this.db) return 0;
    const leases = await this.db.query<{
      id: string;
      installment: string;
      paid: string;
      start_ts: string;
      interval_seconds: string;
    }>(`SELECT id, installment, paid, start_ts, interval_seconds FROM leases WHERE status = 'Active';`);
    let sent = 0;
    for (const l of leases.rows) {
      const installment = BigInt(String(l.installment));
      if (installment <= 0n) continue;
      const covered = BigInt(String(l.paid)) / installment;
      const nextDue = Number(l.start_ts) + Number(covered + 1n) * Number(l.interval_seconds);
      if (nextDue < nowUnix || nextDue - nowUnix > windowSeconds) continue;
      const kind = `due_soon:${nextDue}`;
      const already = await this.db.query(`SELECT id FROM rider_notices WHERE lease_id = $1 AND kind = $2;`, [l.id, kind]);
      if (already.rows.length) continue;
      const ok = await this.notifyLease(String(l.id), "due_soon", {
        amount: tokenToNairaText(installment, await this.rate(String(l.id))),
        dueDate: formatDate(nextDue),
      });
      if (ok) {
        await this.db.query(`INSERT INTO rider_notices (lease_id, kind, channel) VALUES ($1, $2, $3);`, [
          l.id,
          kind,
          this.driver.name,
        ]);
        sent++;
      }
    }
    return sent;
  }
}
