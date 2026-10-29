import {
  decryptContactInfo,
  fromScaled,
  toScaled,
  TOKEN_DECIMALS,
  type LeaseChain,
  type LeaseSnapshot,
  type LeaseStatusName,
  type Queryable,
} from "@mallaka/shared";
import type { FxQuote } from "@mallaka/payments";
import type { ApiDeps, AuthUser } from "./types.js";
import { notFound } from "./errors.js";

/** A leases row joined with its asset (and lessee for staff). Numeric columns arrive as strings or numbers. */
export interface LeaseRow {
  id: string | number;
  lessor_id: string;
  lessee_id: string | null;
  lessee_address: string;
  total_price: string | number;
  deposit: string | number;
  installment: string | number;
  interval_seconds: string | number;
  grace_period_seconds: string | number;
  repossession_wait_seconds: string | number;
  paid: string | number;
  start_ts: string | number;
  status: LeaseStatusName;
  updated_at: Date | string;
  asset_type: string;
  device_id: string;
}

export const LEASE_SELECT = `
  SELECT l.id, l.lessor_id, l.lessee_id, l.lessee_address, l.total_price, l.deposit, l.installment,
         l.interval_seconds, l.grace_period_seconds, l.repossession_wait_seconds, l.paid, l.start_ts,
         l.status, l.updated_at, a.asset_type, a.device_id
  FROM leases l JOIN assets a ON a.id = l.asset_id`;

const big = (v: string | number) => BigInt(String(v));

/** Decimal token string with at least 2 and at most 7 decimals, e.g. "12.50". */
export function tokenText(units: bigint): string {
  const s = fromScaled(units, TOKEN_DECIMALS).replace(/0+$/, "");
  const [w, f = ""] = s.split(".");
  return `${w || "0"}.${f.padEnd(2, "0")}`;
}

/** Naira (2 dp, no grouping) for a token amount at a rate. Display only. */
export function nairaText(units: bigint, nairaPerToken: string): string {
  const kobo = (units * toScaled(nairaPerToken, 6) * 100n) / (10n ** BigInt(TOKEN_DECIMALS) * 1_000_000n);
  return fromScaled(kobo, 2);
}

/** Who may see/act on a lease. Riders: their own. Staff: their lessor's. Admin: all. */
export function canAccessLease(user: AuthUser, row: Pick<LeaseRow, "lessor_id" | "lessee_id">): boolean {
  if (user.role === "admin") return true;
  if (user.role === "lessor_staff") return !!user.lessorId && user.lessorId === row.lessor_id;
  return row.lessee_id === user.id;
}

export async function loadLease(db: Queryable, id: string): Promise<LeaseRow | undefined> {
  const r = await db.query<LeaseRow>(`${LEASE_SELECT} WHERE l.id = $1;`, [id]);
  return r.rows[0];
}

export async function loadAccessibleLease(db: Queryable, user: AuthUser, id: string): Promise<LeaseRow> {
  const row = await loadLease(db, id);
  if (!row) throw notFound("Lease not found");
  // 404 (not 403) for other people's leases so ids cannot be probed.
  if (!canAccessLease(user, row)) throw notFound("Lease not found");
  return row;
}

interface Derived {
  nextDue: number | null;
  graceEnds: number | null;
  remaining: bigint;
  arrears: bigint;
  status: LeaseStatusName;
}

/** Cache-only derivation (README 8.1-8.2). The chain read is authoritative. */
function deriveFromCache(row: LeaseRow, nowSeconds: number): Derived {
  const total = big(row.total_price);
  const deposit = big(row.deposit);
  const installment = big(row.installment);
  const paid = big(row.paid);
  const remaining = total - deposit - paid > 0n ? total - deposit - paid : 0n;
  const live = ["Active", "Grace", "Defaulted"].includes(row.status) && installment > 0n && Number(row.start_ts) > 0;
  if (!live) return { nextDue: null, graceEnds: null, remaining, arrears: 0n, status: row.status };
  const interval = Number(row.interval_seconds);
  const covered = paid / installment;
  const nextDue = Number(row.start_ts) + Number(covered + 1n) * interval;
  const dueCount = BigInt(Math.max(0, Math.floor((nowSeconds - Number(row.start_ts)) / interval)));
  const owed = dueCount > covered ? (dueCount - covered) * installment : 0n;
  return {
    nextDue,
    graceEnds: nowSeconds > nextDue ? nextDue + Number(row.grace_period_seconds) : null,
    remaining,
    arrears: owed > remaining ? remaining : owed,
    status: row.status,
  };
}

function derivedFromSnapshot(s: LeaseSnapshot): Derived {
  const live = ["Active", "Grace", "Defaulted"].includes(s.derivedStatus);
  return {
    nextDue: live ? s.nextDue : null,
    graceEnds: live && s.arrears !== "0" ? s.nextDue + s.graceSeconds : null,
    remaining: BigInt(s.remainingBalance),
    arrears: BigInt(s.arrears),
    status: s.derivedStatus,
  };
}

export interface BuildLeaseViewInput {
  row: LeaseRow;
  user: AuthUser;
  fx: FxQuote;
  snapshot?: LeaseSnapshot;
  stale: boolean;
  nowSeconds: number;
  phoneLast4?: string;
}

/** Builds the response object. Role decides which fields are included (privacy, README 19). */
export function buildLeaseView(i: BuildLeaseViewInput) {
  const { row, user, fx } = i;
  const d = i.snapshot ? derivedFromSnapshot(i.snapshot) : deriveFromCache(row, i.nowSeconds);
  const total = big(row.total_price);
  const deposit = big(row.deposit);
  const paid = i.snapshot ? BigInt(i.snapshot.paid) : big(row.paid);
  const pair = (units: bigint) => ({ token: tokenText(units), naira: nairaText(units, fx.nairaPerToken) });
  const payable = total - deposit;
  const progress = payable > 0n ? Number((paid * 100n) / payable) : 0;
  const isStaff = user.role !== "rider";
  return {
    id: String(row.id),
    status: d.status,
    terms: {
      totalPrice: pair(total),
      deposit: pair(deposit),
      installment: pair(big(row.installment)),
      intervalSeconds: Number(row.interval_seconds),
      graceSeconds: Number(row.grace_period_seconds),
      repossessionWaitSeconds: Number(row.repossession_wait_seconds),
    },
    balance: { paid: pair(paid), remaining: pair(d.remaining), arrears: pair(d.arrears) },
    nextDue: d.nextDue,
    graceEnds: d.graceEnds,
    progressPercent: Math.min(100, Math.max(0, progress)),
    asset: isStaff ? { type: row.asset_type, deviceId: row.device_id } : { type: row.asset_type },
    ...(isStaff && row.lessee_id
      ? { lessee: { id: row.lessee_id, ...(i.phoneLast4 ? { phoneLast4: i.phoneLast4 } : {}) } }
      : {}),
    fx: { nairaPerToken: fx.nairaPerToken, source: fx.source },
    source: i.snapshot ? ("chain" as const) : ("cache" as const),
    stale: i.stale,
    updatedAt: new Date(i.snapshot ? i.nowSeconds * 1000 : row.updated_at).toISOString(),
  };
}

/** Last 4 digits of a user's phone for staff views. Decrypts only for roles that need it. */
export async function phoneLast4(db: Queryable, secret: string, userId: string | null): Promise<string | undefined> {
  if (!userId) return undefined;
  const r = await db.query<{ contact_info_encrypted: string }>(`SELECT contact_info_encrypted FROM users WHERE id = $1;`, [userId]);
  if (!r.rows[0]) return undefined;
  try {
    const info = decryptContactInfo<{ phone?: string }>(r.rows[0].contact_info_encrypted, secret);
    return info.phone ? info.phone.slice(-4) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Serves from the Postgres cache, falling back to a fresh chain read when the
 * cache is stale or when `fresh` is requested (README 9). If the chain is
 * unreachable the cached state is returned flagged `stale: true`.
 */
export async function leaseViewFor(deps: ApiDeps, user: AuthUser, row: LeaseRow, fresh: boolean) {
  const now = (deps.now ?? (() => new Date()))();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const fx = await deps.fx.getQuote();
  const staleAfter = (deps.cacheStaleSeconds ?? 120) * 1000;
  const cacheAge = now.getTime() - new Date(row.updated_at).getTime();
  const needsChain = fresh || cacheAge > staleAfter;
  const last4 = user.role === "rider" ? undefined : await phoneLast4(deps.db, deps.jwtSecret, row.lessee_id);

  let snapshot: LeaseSnapshot | undefined;
  let stale = false;
  if (needsChain) {
    try {
      snapshot = await readAndCache(deps.db, deps.chain, String(row.id));
    } catch {
      stale = true; // serve the cache, clearly flagged
    }
  }
  return buildLeaseView({ row, user, fx, snapshot, stale, nowSeconds, phoneLast4: last4 });
}

/** Reads the chain and refreshes the cache row. */
export async function readAndCache(db: Queryable, chain: LeaseChain, leaseId: string): Promise<LeaseSnapshot> {
  const snap = await chain.getSnapshot(leaseId);
  await db.query(`UPDATE leases SET status = $1, paid = $2, start_ts = $3, updated_at = NOW() WHERE id = $4;`, [
    snap.derivedStatus,
    snap.paid,
    snap.startTs,
    leaseId,
  ]);
  return snap;
}
