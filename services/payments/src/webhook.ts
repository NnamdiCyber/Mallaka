import type { Queryable } from "@mallaka/shared";
import { toScaled, fromScaled, TOKEN_DECIMALS, createLogger, type Logger } from "@mallaka/shared";
import type { FxRateProvider } from "./fx.js";
import { parseFlutterwave, parsePaystack, type Provider, type ParseResult } from "./providers.js";
import { verifyFlutterwaveHash, verifyPaystackSignature } from "./signature.js";
import type { PayJobQueue } from "./queue.js";

export interface WebhookDeps {
  db: Queryable;
  fx: FxRateProvider;
  queue: PayJobQueue;
  paystackSecretKey?: string;
  flutterwaveSecretHash?: string;
  logger?: Logger;
}

export type WebhookOutcome =
  | { status: "accepted"; paymentId: string }
  | { status: "duplicate" }
  | { status: "ignored"; reason: string }
  | { status: "invalid_signature" };

/**
 * Core webhook handling, independent of HTTP. Order matters:
 *  1. verify signature on the RAW body (reject if invalid, nothing else happens)
 *  2. parse; only successful NGN payments continue
 *  3. find OUR payment intent by the provider reference (lease and payer come from our record)
 *  4. record the payment with an INSERT on the unique provider_reference (a unique violation means replay)
 *     so a replay does NOTHING (no new row, no enqueue)
 *  5. enqueue the on-chain pay job
 */
export async function handleWebhook(
  provider: Provider,
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  deps: WebhookDeps
): Promise<WebhookOutcome> {
  const logger = deps.logger ?? createLogger("payments:webhook");
  const header = (name: string) => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const signatureOk =
    provider === "paystack"
      ? verifyPaystackSignature(rawBody, header("x-paystack-signature"), deps.paystackSecretKey)
      : verifyFlutterwaveHash(header("verif-hash"), deps.flutterwaveSecretHash);
  if (!signatureOk) {
    logger.warn("Rejected webhook with invalid signature", { provider });
    return { status: "invalid_signature" };
  }

  let parsed: ParseResult;
  try {
    const body = JSON.parse(rawBody);
    parsed = provider === "paystack" ? parsePaystack(body) : parseFlutterwave(body);
  } catch {
    return { status: "ignored", reason: "malformed body" };
  }
  if (parsed.kind === "ignored") return { status: "ignored", reason: parsed.reason };
  const { reference, nairaAmount } = parsed.payment;

  const intentRes = await deps.db.query<{ lease_id: string; payer_address: string; provider: string }>(
    `SELECT lease_id, payer_address, provider FROM payment_intents WHERE reference = $1;`,
    [reference]
  );
  const intent = intentRes.rows[0];
  if (!intent || intent.provider !== provider) {
    // Acknowledge (so the provider stops retrying) but leave a trail. No credit is given.
    await deps.db.query(
      `INSERT INTO audit_log (actor, action, resource, details) VALUES ('payments:webhook', 'unknown_payment_reference', $1, $2);`,
      [`payment_ref:${reference}`, JSON.stringify({ provider })]
    );
    logger.warn("Webhook for unknown payment reference", { provider, reference });
    return { status: "ignored", reason: "unknown reference" };
  }

  const quote = await deps.fx.getQuote();
  const tokenAmount = nairaToToken(nairaAmount, quote.nairaPerToken);

  // Idempotency: the UNIQUE provider_reference decides. A replay violates it and does nothing.
  let paymentId: string;
  try {
    const ins = await deps.db.query<{ id: string }>(
      `INSERT INTO payments
         (lease_id, payer_address, naira_amount, token_amount, fx_rate, fx_rate_source, provider, provider_reference, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       RETURNING id;`,
      [intent.lease_id, intent.payer_address, nairaAmount, tokenAmount.toString(), quote.nairaPerToken, quote.source, provider, reference]
    );
    paymentId = ins.rows[0].id;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "23505" || /duplicate key|unique constraint/i.test(e.message ?? "")) {
      logger.info("Replayed webhook ignored", { provider, reference });
      return { status: "duplicate" };
    }
    throw err;
  }

  await deps.queue.enqueue(paymentId);
  return { status: "accepted", paymentId };
}

/** naira (2 dp) / (naira per token) -> token base units, rounded down. */
export function nairaToToken(nairaAmount: string, nairaPerToken: string): bigint {
  const kobo = toScaled(nairaAmount, 2);
  const rateMicro = toScaled(nairaPerToken, 6);
  if (rateMicro <= 0n) throw new Error("FX rate must be positive");
  // token = kobo/100 / (rateMicro/1e6) * 10^TOKEN_DECIMALS
  return (kobo * 10n ** BigInt(TOKEN_DECIMALS) * 1_000_000n) / (100n * rateMicro);
}

export { fromScaled };
