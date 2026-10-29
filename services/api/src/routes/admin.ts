import type { FastifyInstance } from "fastify";
import { errorResponses, leaseIdParams } from "../schemas.js";
import { ApiError, forbidden } from "../errors.js";
import { loadAccessibleLease } from "../lease-view.js";
import type { AuthUser } from "../types.js";

const security = [{ bearerAuth: [] }];

const commandResponse = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["queued", "approval_required"] },
    commandId: { type: "string", format: "uuid" },
    approvalId: { type: "string", format: "uuid" },
    message: { type: "string" },
  },
  required: ["status", "message"],
} as const;

const reasonProp = { type: "string", minLength: 10, maxLength: 500, description: "Why this action is needed (recorded in the audit log)" } as const;

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const { deps } = app;
  const actorOf = (u: AuthUser) => `${u.role}:${u.id}`;

  const audit = (u: AuthUser, action: string, leaseId: string, details: Record<string, unknown>, ip: string) =>
    deps.db.query(`INSERT INTO audit_log (actor, action, resource, details, ip_address) VALUES ($1, $2, $3, $4, $5);`, [
      actorOf(u),
      action,
      `lease:${leaseId}`,
      JSON.stringify(details),
      ip,
    ]);

  /** Writes the queued command. The lock bridge executes it after re-reading chain state and applying safety rules. */
  async function queueCommand(
    command: "lock" | "unlock",
    leaseId: string,
    deviceId: string,
    assetId: string,
    triggeredBy: string,
    approvedBy: string | null,
    reason: string
  ): Promise<string> {
    const r = await deps.db.query<{ id: string }>(
      `INSERT INTO lock_commands (lease_id, asset_id, device_id, command, triggered_by, two_person_approved_by, status, result_details)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7) RETURNING id;`,
      [leaseId, assetId, deviceId, command, triggeredBy, approvedBy, JSON.stringify({ reason, source: "manual" })]
    );
    return r.rows[0].id;
  }

  async function assetFor(leaseId: string) {
    const r = await deps.db.query<{ asset_id: string; device_id: string }>(
      `SELECT l.asset_id, a.device_id FROM leases l JOIN assets a ON a.id = l.asset_id WHERE l.id = $1;`,
      [leaseId]
    );
    return r.rows[0];
  }

  app.post(
    "/v1/admin/leases/:id/lock",
    {
      preValidation: app.guard("lessor_staff", "admin"),
      schema: {
        tags: ["admin"],
        summary: "Manual lock (Phase 1). Above the threshold a second approver is required",
        description:
          "Only valid while the lease is Defaulted on-chain. Fails open if the chain cannot be read. " +
          "If the remaining balance exceeds the configured threshold, the first call records an approval request; " +
          "a DIFFERENT staff member or admin repeats the call with the approvalId to approve it.",
        security,
        params: leaseIdParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["reason"],
          properties: { reason: reasonProp, approvalId: { type: "string", format: "uuid" } },
        },
        response: { 202: commandResponse, ...errorResponses },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { reason, approvalId } = req.body as { reason: string; approvalId?: string };
      const user = req.user;
      await loadAccessibleLease(deps.db, user, id);

      // Re-read the chain (never trust the cache). FAIL OPEN: no chain confirmation, no lock.
      let snap;
      try {
        snap = await deps.chain.getSnapshot(id);
      } catch {
        throw new ApiError("Cannot confirm the lease state right now, so no lock was issued", 503, "CHAIN_UNAVAILABLE");
      }
      if (snap.derivedStatus !== "Defaulted") {
        throw new ApiError("Only a lease in default can be locked", 409, "NotDefaulted");
      }

      const asset = await assetFor(id);
      const needsSecondApprover = BigInt(snap.remainingBalance) > deps.manualLockApprovalThreshold;

      if (!needsSecondApprover) {
        const commandId = await queueCommand("lock", id, asset.device_id, asset.asset_id, actorOf(user), null, reason);
        await audit(user, "lock_requested", id, { reason, commandId }, req.ip);
        return reply.code(202).send({ status: "queued", commandId, message: "Lock queued. Safety rules are checked before it is sent." });
      }

      if (!approvalId) {
        const a = await deps.db.query<{ id: string }>(
          `INSERT INTO lock_approvals (lease_id, requested_by, reason, status) VALUES ($1, $2, $3, 'pending') RETURNING id;`,
          [id, actorOf(user), reason]
        );
        await audit(user, "lock_approval_requested", id, { reason, approvalId: a.rows[0].id }, req.ip);
        return reply.code(202).send({
          status: "approval_required",
          approvalId: a.rows[0].id,
          message: "A second person must approve this lock.",
        });
      }

      const found = await deps.db.query<{ id: string; requested_by: string; status: string; reason: string }>(
        `SELECT id, requested_by, status, reason FROM lock_approvals WHERE id = $1 AND lease_id = $2;`,
        [approvalId, id]
      );
      const approval = found.rows[0];
      if (!approval) throw new ApiError("Approval request not found", 404, "NOT_FOUND");
      if (approval.status !== "pending") throw new ApiError("This approval was already used", 409, "CONFLICT");
      if (approval.requested_by === actorOf(user)) throw forbidden("A different person must approve this lock");

      await deps.db.query(`UPDATE lock_approvals SET status = 'approved', approved_by = $1, approved_at = NOW() WHERE id = $2;`, [
        actorOf(user),
        approvalId,
      ]);
      const commandId = await queueCommand("lock", id, asset.device_id, asset.asset_id, approval.requested_by, actorOf(user), approval.reason);
      await audit(user, "lock_approved", id, { approvalId, requestedBy: approval.requested_by, commandId }, req.ip);
      return reply.code(202).send({ status: "queued", commandId, message: "Approved. Lock queued; safety rules are checked before it is sent." });
    }
  );

  app.post(
    "/v1/admin/leases/:id/unlock",
    {
      preValidation: app.guard("lessor_staff", "admin"),
      schema: {
        tags: ["admin"],
        summary: "Manual unlock. Never needs a second approver (it releases the rider)",
        security,
        params: leaseIdParams,
        body: { type: "object", additionalProperties: false, required: ["reason"], properties: { reason: reasonProp } },
        response: { 202: commandResponse, ...errorResponses },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { reason } = req.body as { reason: string };
      await loadAccessibleLease(deps.db, req.user, id);
      const asset = await assetFor(id);
      const commandId = await queueCommand("unlock", id, asset.device_id, asset.asset_id, actorOf(req.user), null, reason);
      await audit(req.user, "unlock_requested", id, { reason, commandId }, req.ip);
      return reply.code(202).send({ status: "queued", commandId, message: "Unlock queued." });
    }
  );

  app.get(
    "/v1/admin/audit-log",
    {
      preValidation: app.guard("lessor_staff", "admin"),
      schema: {
        tags: ["admin"],
        summary: "Audit log (read-only). Admin: everything; lessor staff: their own leases",
        security,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              entries: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    actor: { type: "string" },
                    action: { type: "string" },
                    resource: { type: "string" },
                    details: { type: "object", additionalProperties: true },
                    ipAddress: { type: ["string", "null"], description: "Admin only" },
                    createdAt: { type: "string", format: "date-time" },
                  },
                  required: ["id", "actor", "action", "resource", "details", "createdAt"],
                },
              },
            },
            required: ["entries"],
          },
          ...errorResponses,
        },
      },
    },
    async (req) => {
      const { limit = 50 } = req.query as { limit?: number };
      const user = req.user;
      type Row = { id: string; actor: string; action: string; resource: string; details: unknown; ip_address: string | null; created_at: Date | string };
      let rows: Row[];
      if (user.role === "admin") {
        rows = (await deps.db.query<Row>(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1;`, [limit])).rows;
      } else {
        // Staff see entries about their own lessor's leases only.
        const mine = await deps.db.query<{ id: string | number }>(`SELECT id FROM leases WHERE lessor_id = $1;`, [user.lessorId ?? ""]);
        const resources = new Set(mine.rows.map((l) => `lease:${l.id}`));
        const all = (await deps.db.query<Row>(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 1000;`)).rows;
        rows = all.filter((r) => resources.has(r.resource)).slice(0, limit);
      }
      return {
        entries: rows.map((r) => ({
          id: r.id,
          actor: r.actor,
          action: r.action,
          resource: r.resource,
          details: typeof r.details === "string" ? JSON.parse(r.details) : (r.details as Record<string, unknown>),
          ...(user.role === "admin" ? { ipAddress: r.ip_address } : {}),
          createdAt: new Date(r.created_at).toISOString(),
        })),
      };
    }
  );
}
