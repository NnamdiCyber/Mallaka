import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { loadConfig, createLogger, type Queryable } from "@mallaka/shared";
import { handleUssd, type UssdDeps } from "./menu.js";

export function buildUssdApp(deps: UssdDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  // Custom parser for application/x-www-form-urlencoded
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    try {
      const parsed = Object.fromEntries(new URLSearchParams(body as string));
      done(null, parsed);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get("/health", async () => ({ status: "ok" }));

  // Main USSD endpoint called by Africa's Talking / telco gateways
  app.post("/ussd", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const sessionId = body.sessionId ?? "";
    const serviceCode = body.serviceCode ?? "";
    const phoneNumber = body.phoneNumber ?? "";
    const text = body.text ?? "";

    const responseText = await handleUssd(
      { sessionId, serviceCode, phoneNumber, text },
      deps
    );

    reply.type("text/plain").send(responseText);
  });

  return app;
}

export async function startUssdService(port = Number(process.env.USSD_PORT ?? 3003)): Promise<FastifyInstance> {
  const config = loadConfig();
  const logger = createLogger("ussd");
  if (!config.JWT_SECRET) throw new Error("JWT_SECRET is required");

  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  const app = buildUssdApp({
    db: pool as Queryable,
    jwtSecret: config.JWT_SECRET,
  });

  await app.listen({ port, host: "0.0.0.0" });
  logger.info("USSD service listening", { port });
  return app;
}
