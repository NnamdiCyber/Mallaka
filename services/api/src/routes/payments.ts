import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { toScaled } from "@mallaka/shared";
import { errorResponses, leaseIdParams, paymentParams, paymentView, receiptView } from "../schemas.js";
import { ApiError, notFound } from "../errors.js";
import { loadAccessibleLease, nairaText, tokenText } from "../lease-view.js";
import { readAndCache } from "../lease-view.js";

const security = [{ bearerAuth: [] }];
const MIN_NAIRA = "100";
const MAX_NAIRA = "5000000";

interface PaymentRow {
  id: string;
  lease_id: string | number;
  naira_amount: string | number;
  token_amount: string | number;
  applied_token_amount: string | number | null;
  excess_naira_amount: string | number;
  fx_rate: string | number;
  provider: string;
  tx_hash: string | null;
  status: string;
  refund_flagged: boolean;
  created_at: Date | string;
  settled_at: Date | string | null;
}

const iso = (d: Date | string) => new Date(d).toISOString();
const money2 = (v: string | number) => Number(v).toFixed(2);

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  const { deps } = app;

  app.get(
    "/v1/leases/:id/payments",
    {
      preValidation: app.guard("rider", "lessor_staff", "admin"),
      schema: {
        tags: ["payments"],
        summary: "Payment history for a lease",
        description: "`settled` means the on-chain payment is final. Anything else is still `processing`.",
        security,
        params: leaseIdParams,
        response: {
          200: { type: "object", properties: { payments: { type: "array", items: paymentView } }, required: ["payments"] },
          ...errorResponses,
        },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      await loadAccessibleLease(deps.db, req.user, id);
      const rows = await deps.db.query<PaymentRow>(`SELECT * FROM payments WHERE lease_id = $1 ORDER BY created_at DESC;`, [id]);
      const staff = req.user.role !== "rider";
      return {
        payments: rows.rows.map((p) => ({
          id: p.id,
          nairaAmount: money2(p.naira_amount),
          status: p.status === "confirmed" ? "settled" : "processing",
          provider: p.provider,
          createdAt: iso(p.created_at),
          settledAt: p.settled_at ? iso(p.settled_at) : null,
          excessFlagged: p.refund_flagged === true,
          ...(staff && p.tx_hash ? { txHash: p.tx_hash } : {}),
        })),
      };
    }
  );

  app.post(
    "/v1/leases/:id/payments/initiate",
    {
      preValidation: app.guard("rider"),
      schema: {
        tags: ["payments"],
        summary: "Start a naira payment; returns the provider checkout",
        security,
        params: leaseIdParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["amountNaira"],
          properties: {
            amountNaira: { type: "string", pattern: "^[0-9]+(\\.[0-9]{1,2})?$", description: "Naira, up to 2 decimals" },
            provider: { type: "string", enum: ["paystack", "flutterwave"], default: "paystack" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              reference: { type: "string" },
              provider: { type: "string" },
              checkoutUrl: { type: "string" },
            },
            required: ["reference", "provider", "checkoutUrl"],
          },
          ...errorResponses,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { amountNaira, provider = "paystack" } = req.body as { amountNaira: string; provider?: "paystack" | "flutterwave" };
      const row = await loadAccessibleLease(deps.db, req.user, id);

      if (!["Active", "Grace", "Defaulted"].includes(row.status)) {
        throw new ApiError("Payments are not open for this lease", 409, "InvalidState");
      }
      if (toScaled(amountNaira, 2) < toScaled(MIN_NAIRA, 2) || toScaled(amountNaira, 2) > toScaled(MAX_NAIRA, 2)) {
        throw new ApiError(`Amount must be between N${MIN_NAIRA} and N${MAX_NAIRA}`, 400, "InvalidAmount");
      }
      const checkout = deps.checkout[provider];
      if (!checkout) throw new ApiError("This payment provider is not available yet", 501, "PROVIDER_NOT_CONFIGURED");

      const reference = `mlk_${crypto.randomUUID().replace(/-/g, "")}`;
      const { checkoutUrl } = await checkout.initialize({
        reference,
        amountNaira,
        riderRef: crypto.createHash("sha256").update(req.user.id).digest("hex").slice(0, 16),
      });
      // Our own record: the webhook reads lease and payer from here, never from provider metadata.
      await deps.db.query(
        `INSERT INTO payment_intents (reference, lease_id, user_id, payer_address, provider, naira_amount, checkout_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7);`,
        [reference, id, req.user.id, row.lessee_address, provider, amountNaira, checkoutUrl]
      );
      return reply.code(201).send({ reference, provider, checkoutUrl });
    }
  );

  app.get(
    "/v1/leases/:id/receipt/:paymentId",
    {
      preValidation: app.guard("rider", "lessor_staff", "admin"),
      schema: {
        tags: ["payments"],
        summary: "Receipt for a settled payment",
        description: "Built from the payment record plus chain data. Contains no name, phone or address.",
        security,
        params: paymentParams,
        response: { 200: receiptView, ...errorResponses },
      },
    },
    async (req) => {
      const { id, paymentId } = req.params as { id: string; paymentId: string };
      const lease = await loadAccessibleLease(deps.db, req.user, id);
      const pr = await deps.db.query<PaymentRow>(`SELECT * FROM payments WHERE id = $1 AND lease_id = $2;`, [paymentId, id]);
      const p = pr.rows[0];
      if (!p) throw notFound("Payment not found");
      if (p.status !== "confirmed") throw new ApiError("This payment is still being processed", 409, "PAYMENT_NOT_SETTLED");

      // Chain data: balance after the payment. Fall back to the cache if the chain is unreachable.
      let remaining: bigint;
      let paid: bigint;
      try {
        const snap = await readAndCache(deps.db, deps.chain, id);
        remaining = BigInt(snap.remainingBalance);
        paid = BigInt(snap.paid);
      } catch {
        paid = BigInt(String(lease.paid));
        remaining = BigInt(String(lease.total_price)) - BigInt(String(lease.deposit)) - paid;
        if (remaining < 0n) remaining = 0n;
      }
      const payable = BigInt(String(lease.total_price)) - BigInt(String(lease.deposit));
      const rate = String(p.fx_rate);
      const lessor = await deps.db.query<{ name: string }>(`SELECT name FROM lessors WHERE id = $1;`, [lease.lessor_id]);
      const excess = Number(p.excess_naira_amount);
      const total = Number(p.naira_amount);

      return {
        receiptNumber: `MLK-${p.id.replace(/-/g, "").slice(0, 10).toUpperCase()}`,
        leaseId: id,
        paidAt: iso(p.settled_at ?? p.created_at),
        nairaAmount: money2(total),
        appliedNairaAmount: money2(total - excess),
        excessNairaAmount: money2(excess),
        paymentMethod: p.provider,
        balanceRemaining: { naira: nairaText(remaining, rate) },
        progressPercent: payable > 0n ? Math.min(100, Number((paid * 100n) / payable)) : 0,
        assetType: lease.asset_type,
        lessorName: lessor.rows[0]?.name ?? "",
        onChainConfirmed: true,
        ...(req.user.role !== "rider" && p.tx_hash ? { txHash: p.tx_hash } : {}),
      };
    }
  );
}

export { tokenText };
