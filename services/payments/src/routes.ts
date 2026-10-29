import type { FastifyInstance } from "fastify";
import { handleWebhook, type WebhookDeps } from "./webhook.js";
import type { Provider } from "./providers.js";

/**
 * Fastify plugin that mounts POST /v1/webhooks/paystack and /v1/webhooks/flutterwave
 * (README 9). Used by the api service, or standalone via startPaymentsService().
 *
 * It registers its own JSON parser inside this plugin's scope that keeps the RAW
 * body string, because provider signatures are computed over the exact bytes.
 */
export async function paymentWebhookRoutes(app: FastifyInstance, deps: WebhookDeps): Promise<void> {
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  const mount = (provider: Provider) => {
    app.post(
      `/v1/webhooks/${provider}`,
      {
        schema: {
          tags: ["webhooks"],
          summary: `${provider === "paystack" ? "Paystack" : "Flutterwave"} payment webhook (signature verified)`,
          response: {
            200: {
              type: "object",
              properties: { status: { type: "string" } },
              required: ["status"],
            },
            401: {
              type: "object",
              properties: { error: { type: "object", additionalProperties: true } },
            },
          },
        },
        // Webhooks are called by providers, not users: rate limit is higher than for user routes.
        config: { rateLimit: { max: 600, timeWindow: "1 minute" } },
      },
      async (request, reply) => {
        const raw = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
        const outcome = await handleWebhook(provider, raw, request.headers, deps);
        if (outcome.status === "invalid_signature") {
          return reply.code(401).send({ error: { code: "INVALID_SIGNATURE", message: "Invalid signature" } });
        }
        // 200 for accepted, duplicate and ignored so providers stop retrying.
        return reply.code(200).send({ status: outcome.status });
      }
    );
  };
  mount("paystack");
  mount("flutterwave");
}
