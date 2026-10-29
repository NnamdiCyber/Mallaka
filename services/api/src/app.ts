import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import { paymentWebhookRoutes } from "@mallaka/payments";
import type { ApiDeps, AuthUser, Role } from "./types.js";
import { forbidden, mapError, unauthorized } from "./errors.js";
import { authRoutes } from "./routes/auth.js";
import { leaseRoutes } from "./routes/leases.js";
import { paymentRoutes } from "./routes/payments.js";
import { adminRoutes } from "./routes/admin.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    deps: ApiDeps;
    /** Verifies the bearer token and requires one of the roles. Every non-public route uses this. */
    guard(...roles: Role[]): (req: FastifyRequest) => Promise<void>;
  }
}

/** Builds the Fastify app. Everything external is injected via `deps` so tests use mocks. */
export async function buildApp(deps: ApiDeps): Promise<FastifyInstance> {
  if (deps.jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false, coerceTypes: "array", useDefaults: true } } });
  app.decorate("deps", deps);

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Mallaka API",
        version: "0.1.0",
        description:
          "REST API for the Mallaka lease-to-own platform (README section 9). The contract is the source of truth; reads come from a Postgres cache and fall back to the chain.",
      },
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
      tags: [
        { name: "auth" }, { name: "leases" }, { name: "payments" }, { name: "webhooks" }, { name: "admin" },
      ],
    },
  });
  await app.register(jwt, { secret: deps.jwtSecret, sign: { expiresIn: "12h" } });
  await app.register(rateLimit, {
    global: true,
    max: deps.rateLimit?.max ?? 100,
    timeWindow: deps.rateLimit?.timeWindow ?? "1 minute",
  });

  app.decorate("guard", (...roles: Role[]) => async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw unauthorized();
    }
    if (!roles.includes(req.user.role)) throw forbidden();
  });

  app.setErrorHandler((err, _req, reply) => {
    const { status, body } = mapError(err);
    return reply.code(status).send(body);
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } })
  );

  await app.register(authRoutes);
  await app.register(leaseRoutes);
  await app.register(paymentRoutes);
  // Provider webhooks are mounted from the payments service (README 9).
  await app.register(paymentWebhookRoutes, {
    db: deps.db,
    fx: deps.fx,
    queue: deps.payQueue,
    paystackSecretKey: deps.paystackSecretKey,
    flutterwaveSecretHash: deps.flutterwaveSecretHash,
  });
  await app.register(adminRoutes);
  return app;
}
