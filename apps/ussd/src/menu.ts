import crypto from "node:crypto";
import { type Queryable, phoneHash, toScaled, fromScaled, TOKEN_DECIMALS } from "@mallaka/shared";

export interface UssdRequest {
  sessionId: string;
  serviceCode: string;
  phoneNumber: string;
  text: string;
}

export interface UssdDeps {
  db: Queryable;
  jwtSecret: string;
  now?: () => Date;
  nairaPerToken?: string;
}

interface LeaseRow {
  id: string | number;
  status: string;
  total_price: string | number;
  deposit: string | number;
  installment: string | number;
  interval_seconds: string | number;
  grace_period_seconds: string | number;
  paid: string | number;
  start_ts: string | number;
  asset_type: string;
  vin_or_serial: string;
  device_id: string;
}

function tokenToNaira(tokenUnits: bigint, nairaPerToken: string): string {
  const rateMicro = toScaled(nairaPerToken, 6);
  const kobo = (tokenUnits * rateMicro * 100n) / (10n ** BigInt(TOKEN_DECIMALS) * 1_000_000n);
  const [whole] = fromScaled(kobo, 2).split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatDate(unixSeconds: number): string {
  if (unixSeconds <= 0) return "Not activated";
  const d = new Date(unixSeconds * 1000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export async function handleUssd(req: UssdRequest, deps: UssdDeps): Promise<string> {
  const rate = deps.nairaPerToken ?? "1500.000000";
  const ph = phoneHash(req.phoneNumber, deps.jwtSecret);
  const userRes = await deps.db.query<{ id: string }>(`SELECT id FROM users WHERE phone_hash = $1;`, [ph]);

  if (userRes.rows.length === 0) {
    return "END Welcome to Mallaka.\nThis phone number is not registered to an active lease.\nPlease contact your fleet manager.";
  }

  const userId = userRes.rows[0].id;
  const leaseRes = await deps.db.query<LeaseRow>(
    `SELECT l.id, l.status, l.total_price, l.deposit, l.installment, l.interval_seconds, l.grace_period_seconds,
            l.paid, l.start_ts, a.asset_type, a.vin_or_serial, a.device_id
     FROM leases l
     JOIN assets a ON a.id = l.asset_id
     WHERE l.lessee_id = $1
     ORDER BY l.created_at DESC
     LIMIT 1;`,
    [userId]
  );

  if (leaseRes.rows.length === 0) {
    return "END You have no registered lease with Mallaka.";
  }

  const lease = leaseRes.rows[0];
  const parts = req.text.trim() === "" ? [] : req.text.trim().split("*");

  if (parts.length === 0) {
    return (
      "CON Welcome to Mallaka\n" +
      "1. Lease Status & Balance\n" +
      "2. Next Due Date\n" +
      "3. Lock & Safety Status\n" +
      "4. Pay Installment\n" +
      "0. Exit"
    );
  }

  const mainOption = parts[0];

  switch (mainOption) {
    case "1": {
      const total = BigInt(lease.total_price);
      const paid = BigInt(lease.paid);
      const remaining = total > paid ? total - paid : 0n;
      return (
        `END Lease Status: ${lease.status}\n` +
        `Asset: ${lease.asset_type}\n` +
        `Total: N${tokenToNaira(total, rate)}\n` +
        `Paid: N${tokenToNaira(paid, rate)}\n` +
        `Remaining: N${tokenToNaira(remaining, rate)}`
      );
    }

    case "2": {
      const installment = BigInt(lease.installment);
      const paid = BigInt(lease.paid);
      const startTs = Number(lease.start_ts);
      const interval = Number(lease.interval_seconds);

      let dueText = "Pending activation";
      if (startTs > 0 && installment > 0n && interval > 0) {
        const covered = paid / installment;
        const nextDue = startTs + Number(covered + 1n) * interval;
        dueText = formatDate(nextDue);
      }

      return (
        `END Next Due Date:\n` +
        `Date: ${dueText}\n` +
        `Installment: N${tokenToNaira(installment, rate)}\n` +
        `Status: ${lease.status}`
      );
    }

    case "3": {
      if (lease.status === "Defaulted") {
        return (
          "END Vehicle Lock Alert:\n" +
          "Status: DEFAULTED.\n" +
          "Remote immobilizer may engage when safely stopped.\n" +
          "Pay outstanding arrears to unlock immediately."
        );
      }
      return (
        "END Lock & Safety Status:\n" +
        "Status: UNLOCKED.\n" +
        "Your vehicle is safe to operate.\n" +
        "Keep daily payments up to date to maintain access."
      );
    }

    case "4": {
      if (parts.length === 1) {
        return "CON Enter amount in Naira to pay (e.g. 5000):";
      }

      const amountStr = parts[1].trim();
      const amountNum = Number(amountStr);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        return "END Invalid amount entered. Please redial to try again.";
      }

      const reference = `mlk_ussd_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
      await deps.db.query(
        `INSERT INTO payment_intents (reference, lease_id, user_id, payer_address, provider, naira_amount, checkout_url)
         VALUES ($1, $2, $3, 'custodial', 'paystack', $4, 'ussd://push');`,
        [reference, String(lease.id), userId, amountStr]
      );

      return (
        `END Payment initiated for N${amountNum.toLocaleString()}.\n` +
        `Ref: ${reference}\n` +
        `Use this reference at your Mallaka agent or dial your bank USSD code.`
      );
    }

    case "0":
      return "END Thank you for using Mallaka. Keep Africa moving!";

    default:
      return "END Invalid option. Please dial the code again.";
  }
}
