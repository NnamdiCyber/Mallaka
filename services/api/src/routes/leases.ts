import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { encryptContactInfo, phoneHash, toScaled, TOKEN_DECIMALS } from "@mallaka/shared";
import { errorResponses, leaseIdParams, leaseList, leaseView, phoneProp } from "../schemas.js";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../errors.js";
import { LEASE_SELECT, loadAccessibleLease, leaseViewFor, loadLease, readAndCache, type LeaseRow } from "../lease-view.js";

const INTERVALS = { daily: 86_400, weekly: 604_800 } as const;
const DAY = 86_400;

const security = [{ bearerAuth: [] }];

export async function leaseRoutes(app: FastifyInstance): Promise<void> {
  const { deps } = app;

  // GET /v1/leases: lessor -> portfolio, rider -> own leases, admin -> all
  app.get(
    "/v1/leases",
    {
      preValidation: app.guard("rider", "lessor_staff", "admin"),
      schema: {
        tags: ["leases"],
        summary: "List leases (lessor: portfolio; rider: own leases)",
        security,
        response: { 200: leaseList, ...errorResponses },
      },
    },
    async (req) => {
      const user = req.user;
      let rows: LeaseRow[];
      if (user.role === "rider") {
        rows = (await deps.db.query<LeaseRow>(`${LEASE_SELECT} WHERE l.lessee_id = $1 ORDER BY l.id;`, [user.id])).rows;
      } else if (user.role === "lessor_staff") {
        rows = (await deps.db.query<LeaseRow>(`${LEASE_SELECT} WHERE l.lessor_id = $1 ORDER BY l.id;`, [user.lessorId ?? ""])).rows;
      } else {
        rows = (await deps.db.query<LeaseRow>(`${LEASE_SELECT} ORDER BY l.id;`)).rows;
      }
      // The list serves the cache; use GET /v1/leases/:id?fresh=true for a chain read.
      const leases = [];
      for (const row of rows) {
        leases.push(await leaseViewFor({ ...deps, cacheStaleSeconds: Number.MAX_SAFE_INTEGER }, user, row, false));
      }
      return { leases };
    }
  );

  // POST /v1/leases: lessor creates a lease (builds the on-chain create_lease, routed via the sponsor)
  app.post(
    "/v1/leases",
    {
      preValidation: app.guard("lessor_staff", "admin"),
      schema: {
        tags: ["leases"],
        summary: "Create a lease (lessor staff)",
        description:
          "Amounts are decimal strings in the settlement currency. Fixed daily/weekly intervals only. " +
          "The asset is anchored on-chain by hash only; no personal data goes on-chain.",
        security,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["asset", "lessee", "totalPrice", "deposit", "installment", "interval", "graceDays", "repossessionWaitDays"],
          properties: {
            asset: {
              type: "object",
              additionalProperties: false,
              required: ["vinOrSerial", "assetType", "deviceId"],
              properties: {
                vinOrSerial: { type: "string", minLength: 3, maxLength: 64 },
                assetType: { type: "string", enum: ["motorcycle", "tricycle", "farm_equipment"] },
                deviceId: { type: "string", minLength: 1, maxLength: 64 },
                photoRefs: {
                  type: "array",
                  maxItems: 10,
                  items: { type: "string", maxLength: 300 },
                  description: "References to uploaded photos (not the files)",
                },
              },
            },
            lessee: {
              type: "object",
              additionalProperties: false,
              required: ["phone"],
              properties: {
                phone: phoneProp,
                address: { type: "string", pattern: "^G[A-Z2-7]{55}$", description: "Custodial account for a new rider" },
              },
            },
            totalPrice: { type: "string", pattern: "^[0-9]+(\\.[0-9]{1,7})?$" },
            deposit: { type: "string", pattern: "^[0-9]+(\\.[0-9]{1,7})?$" },
            installment: { type: "string", pattern: "^[0-9]+(\\.[0-9]{1,7})?$" },
            interval: { type: "string", enum: ["daily", "weekly"] },
            graceDays: { type: "integer", minimum: 0, maximum: 60 },
            repossessionWaitDays: { type: "integer", minimum: 0, maximum: 365 },
          },
        },
        response: { 201: leaseView, ...errorResponses },
      },
    },
    async (req, reply) => {
      const user = req.user;
      const b = req.body as {
        asset: { vinOrSerial: string; assetType: string; deviceId: string; photoRefs?: string[] };
        lessee: { phone: string; address?: string };
        totalPrice: string;
        deposit: string;
        installment: string;
        interval: "daily" | "weekly";
        graceDays: number;
        repossessionWaitDays: number;
      };
      if (!user.lessorId) throw badRequest("Your account is not linked to a lessor", "NO_LESSOR");

      const total = toScaled(b.totalPrice, TOKEN_DECIMALS);
      const deposit = toScaled(b.deposit, TOKEN_DECIMALS);
      const installment = toScaled(b.installment, TOKEN_DECIMALS);
      // Mirrors contract validation so the user gets InvalidTerms before any chain call.
      if (total <= 0n || installment <= 0n || deposit >= total || installment > total - deposit) {
        throw new ApiError("The lease terms are not valid", 400, "InvalidTerms");
      }

      const lessor = await deps.db.query<{ stellar_address: string }>(`SELECT stellar_address FROM lessors WHERE id = $1;`, [user.lessorId]);
      if (!lessor.rows[0]) throw notFound("Lessor not found");

      // Find or create the rider. Phone is stored only as encrypted blob + keyed hash.
      const ph = phoneHash(b.lessee.phone, deps.jwtSecret);
      const existing = await deps.db.query<{ id: string; public_key: string | null }>(
        `SELECT id, public_key FROM users WHERE phone_hash = $1;`,
        [ph]
      );
      let riderId = existing.rows[0]?.id;
      const lesseeAddress = existing.rows[0]?.public_key ?? b.lessee.address;
      if (!lesseeAddress) throw badRequest("A new rider needs a custodial account address", "LESSEE_ADDRESS_REQUIRED");
      if (!riderId) {
        const created = await deps.db.query<{ id: string }>(
          `INSERT INTO users (role, lessor_id, public_key, contact_info_encrypted, phone_hash)
           VALUES ('rider', $1, $2, $3, $4) RETURNING id;`,
          [user.lessorId, lesseeAddress, encryptContactInfo({ phone: b.lessee.phone }, deps.jwtSecret), ph]
        );
        riderId = created.rows[0].id;
      }

      const dup = await deps.db.query(`SELECT id FROM assets WHERE vin_or_serial = $1;`, [b.asset.vinOrSerial]);
      if (dup.rows.length) throw conflict("An asset with this VIN or serial already exists", "ASSET_EXISTS");

      // On-chain anchor is a hash of the off-chain record (README 5 privacy note).
      const assetHash = crypto.createHash("sha256").update(`${user.lessorId}:${b.asset.vinOrSerial}`).digest("hex");

      // Build the on-chain call and route it through the sponsor. No XLM from the user, no keys exposed.
      const prepared = await deps.chain.prepare({
        kind: "create_lease",
        lessor: lessor.rows[0].stellar_address,
        lessee: lesseeAddress,
        assetIdHex: assetHash,
        titleContract: deps.contracts.titleRegistry,
        token: deps.contracts.token,
        totalPrice: total.toString(),
        deposit: deposit.toString(),
        installment: installment.toString(),
        intervalSeconds: INTERVALS[b.interval],
        graceSeconds: b.graceDays * DAY,
      });
      const outcome = await deps.chain.submit(prepared);
      if (outcome.returnValue === undefined || outcome.returnValue === null) {
        throw new ApiError("Chain did not return a lease id", 502, "CHAIN_UNAVAILABLE");
      }
      const leaseId = String(outcome.returnValue);

      const asset = await deps.db.query<{ id: string }>(
        `INSERT INTO assets (lessor_id, vin_or_serial, asset_type, photos, device_id, asset_hash)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id;`,
        [user.lessorId, b.asset.vinOrSerial, b.asset.assetType, JSON.stringify(b.asset.photoRefs ?? []), b.asset.deviceId, assetHash]
      );
      await deps.db.query(
        `INSERT INTO leases (id, lessor_id, asset_id, lessee_id, lessor_address, lessee_address, token_address,
           title_contract_address, total_price, deposit, installment, interval_seconds, grace_period_seconds,
           repossession_wait_seconds, paid, start_ts, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,0,'Pending');`,
        [
          leaseId, user.lessorId, asset.rows[0].id, riderId, lessor.rows[0].stellar_address, lesseeAddress,
          deps.contracts.token, deps.contracts.titleRegistry, total.toString(), deposit.toString(), installment.toString(),
          INTERVALS[b.interval], b.graceDays * DAY, b.repossessionWaitDays * DAY,
        ]
      );
      await deps.db.query(`INSERT INTO audit_log (actor, action, resource, details, ip_address) VALUES ($1, 'lease_created', $2, $3, $4);`, [
        `${user.role}:${user.id}`,
        `lease:${leaseId}`,
        JSON.stringify({ assetType: b.asset.assetType, interval: b.interval }),
        req.ip,
      ]);

      const row = (await loadLease(deps.db, leaseId))!;
      return reply.code(201).send(await leaseViewFor(deps, user, row, false));
    }
  );

  // GET /v1/leases/:id: terms + live status (cache, with fresh chain read on request or when stale)
  app.get(
    "/v1/leases/:id",
    {
      preValidation: app.guard("rider", "lessor_staff", "admin"),
      schema: {
        tags: ["leases"],
        summary: "Lease terms and live status",
        description: "Served from the Postgres cache. Pass `fresh=true` (or let the cache go stale) to read the chain.",
        security,
        params: leaseIdParams,
        querystring: { type: "object", properties: { fresh: { type: "boolean", default: false } }, additionalProperties: false },
        response: { 200: leaseView, ...errorResponses },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { fresh } = req.query as { fresh?: boolean };
      const row = await loadAccessibleLease(deps.db, req.user, id);
      return leaseViewFor(deps, req.user, row, fresh === true);
    }
  );

  // POST /v1/leases/:id/activate: rider signs (custodially) and pays the deposit
  app.post(
    "/v1/leases/:id/activate",
    {
      preValidation: app.guard("rider"),
      schema: {
        tags: ["leases"],
        summary: "Activate a pending lease (rider signs and pays the deposit)",
        security,
        params: leaseIdParams,
        response: { 200: leaseView, ...errorResponses },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const row = await loadAccessibleLease(deps.db, req.user, id);
      if (row.lessee_id !== req.user.id) throw forbidden();
      if (row.status !== "Pending") throw new ApiError("The lease is already active", 409, "AlreadyActive");

      // Custodial signing (ADR-008), fee paid by the sponsor. The rider never handles keys or XLM.
      const prepared = await deps.chain.prepare({ kind: "activate", leaseId: String(row.id), lessee: row.lessee_address });
      await deps.chain.submit(prepared);
      await readAndCache(deps.db, deps.chain, String(row.id));
      await deps.db.query(`INSERT INTO audit_log (actor, action, resource, details, ip_address) VALUES ($1, 'lease_activated', $2, '{}', $3);`, [
        `rider:${req.user.id}`,
        `lease:${row.id}`,
        req.ip,
      ]);
      return leaseViewFor(deps, req.user, (await loadLease(deps.db, id))!, false);
    }
  );
}
