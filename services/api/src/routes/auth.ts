import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { phoneHash } from "@mallaka/shared";
import { errorResponses, phoneProp } from "../schemas.js";
import { ApiError } from "../errors.js";

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/** Hash binds the code to the phone and the server secret so a leaked table cannot be replayed. */
const hashCode = (code: string, phoneH: string, secret: string) =>
  crypto.createHmac("sha256", secret).update(`${phoneH}:${code}`).digest("hex");

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { deps } = app;

  app.post(
    "/v1/auth/otp/request",
    {
      schema: {
        tags: ["auth"],
        summary: "Request a login code by SMS",
        body: {
          type: "object",
          properties: { phone: phoneProp },
          required: ["phone"],
          additionalProperties: false,
        },
        response: {
          202: { type: "object", properties: { status: { type: "string" } }, required: ["status"] },
          ...errorResponses,
        },
      },
      // Strict limit: SMS costs money and this endpoint is public.
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const { phone } = req.body as { phone: string };
      const ph = phoneHash(phone, deps.jwtSecret);
      const user = await deps.db.query(`SELECT id FROM users WHERE phone_hash = $1;`, [ph]);
      // Same answer whether or not the number is known: no account enumeration.
      if (user.rows.length > 0) {
        const code = (deps.generateOtp ?? (() => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0")))();
        const now = (deps.now ?? (() => new Date()))();
        await deps.db.query(`UPDATE otp_codes SET consumed = TRUE WHERE phone_hash = $1 AND consumed = FALSE;`, [ph]);
        await deps.db.query(`INSERT INTO otp_codes (phone_hash, code_hash, expires_at) VALUES ($1, $2, $3);`, [
          ph,
          hashCode(code, ph, deps.jwtSecret),
          new Date(now.getTime() + OTP_TTL_MS).toISOString(),
        ]);
        await deps.otp.sendOtp(phone, code);
      }
      return reply.code(202).send({ status: "sent" });
    }
  );

  app.post(
    "/v1/auth/otp/verify",
    {
      schema: {
        tags: ["auth"],
        summary: "Exchange phone and code for a session token",
        body: {
          type: "object",
          properties: { phone: phoneProp, code: { type: "string", pattern: "^[0-9]{6}$" } },
          required: ["phone", "code"],
          additionalProperties: false,
        },
        response: {
          200: {
            type: "object",
            properties: {
              token: { type: "string" },
              role: { type: "string", enum: ["rider", "lessor_staff", "admin"] },
            },
            required: ["token", "role"],
          },
          ...errorResponses,
        },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req) => {
      const { phone, code } = req.body as { phone: string; code: string };
      const ph = phoneHash(phone, deps.jwtSecret);
      const now = (deps.now ?? (() => new Date()))();
      const invalid = new ApiError("That code is not valid or has expired", 401, "INVALID_CODE");

      const otp = await deps.db.query<{ id: string; code_hash: string; expires_at: Date | string; attempts: number }>(
        `SELECT id, code_hash, expires_at, attempts FROM otp_codes
         WHERE phone_hash = $1 AND consumed = FALSE ORDER BY created_at DESC LIMIT 1;`,
        [ph]
      );
      const row = otp.rows[0];
      if (!row || new Date(row.expires_at).getTime() < now.getTime() || row.attempts >= MAX_ATTEMPTS) throw invalid;

      const expected = Buffer.from(row.code_hash);
      const given = Buffer.from(hashCode(code, ph, deps.jwtSecret));
      if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
        await deps.db.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1;`, [row.id]);
        throw invalid;
      }
      await deps.db.query(`UPDATE otp_codes SET consumed = TRUE WHERE id = $1;`, [row.id]);

      const user = await deps.db.query<{ id: string; role: "rider" | "lessor_staff" | "admin"; lessor_id: string | null }>(
        `SELECT id, role, lessor_id FROM users WHERE phone_hash = $1;`,
        [ph]
      );
      const u = user.rows[0];
      if (!u) throw invalid;
      const token = app.jwt.sign({ id: u.id, role: u.role, ...(u.lessor_id ? { lessorId: u.lessor_id } : {}) });
      return { token, role: u.role };
    }
  );
}
