import pg from "pg";
import { Queue } from "bullmq";
import { rpc } from "@stellar/stellar-sdk";
import { Logger, createLogger } from "@mallaka/shared";
import { ParsedEvent, parseSorobanEvent } from "./event-parser.js";

export interface IndexerOptions {
  pgPool: pg.Pool;
  rpcServer: rpc.Server;
  leaseContractId: string;
  titleRegistryContractId?: string;
  lockBridgeQueue?: Queue;
  notificationQueue?: Queue;
  pollIntervalMs?: number;
  batchSize?: number;
  logger?: Logger;
}

function safeJsonStringify(obj: unknown): string {
  if (obj === undefined || obj === null) {
    return "{}";
  }
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
    return value;
  });
}

export class IndexerService {
  private readonly pgPool: pg.Pool;
  private readonly rpcServer: rpc.Server;
  private readonly contractIds: string[];
  private readonly lockBridgeQueue?: Queue;
  private readonly notificationQueue?: Queue;
  private readonly pollIntervalMs: number;
  private readonly logger: Logger;
  private isRunning = false;

  constructor(options: IndexerOptions) {
    this.pgPool = options.pgPool;
    this.rpcServer = options.rpcServer;
    this.contractIds = [options.leaseContractId];
    if (options.titleRegistryContractId) {
      this.contractIds.push(options.titleRegistryContractId);
    }
    this.lockBridgeQueue = options.lockBridgeQueue;
    this.notificationQueue = options.notificationQueue;
    this.pollIntervalMs = options.pollIntervalMs ?? 3000;
    this.logger = options.logger ?? createLogger("indexer");
  }

  /**
   * Retrieves the latest indexed ledger cursor from the chain_events table.
   * Resumes seamlessly after restart without gaps.
   */
  async getStoredCursor(): Promise<number | null> {
    const res = await this.pgPool.query<{ max_ledger: string }>(
      `SELECT MAX(ledger_sequence) as max_ledger FROM chain_events;`
    );
    const max = res.rows[0]?.max_ledger;
    return max ? parseInt(max, 10) : null;
  }

  /**
   * Ingests a single parsed event:
   * 1. Persists to chain_events (with ledger cursor) BEFORE fan-out
   * 2. Updates cached leases table in Postgres to mirror chain state
   * 3. Fans out to Lock Bridge queue and Notifications queue
   */
  async processEvent(client: pg.PoolClient | pg.ClientBase, event: ParsedEvent): Promise<boolean> {
    // 0. Check for existing event to ensure strict idempotency across all environments
    const existing = await client.query(
      `SELECT id FROM chain_events WHERE tx_hash = $1 AND event_index = $2;`,
      [event.txHash, event.eventIndex]
    );
    if (existing.rows.length > 0) {
      this.logger.debug("Duplicate event skipped", { txHash: event.txHash, index: event.eventIndex });
      return false;
    }

    // 1. Persist raw event with ledger cursor BEFORE fan-out (README Section 19)
    await client.query(
      `
      INSERT INTO chain_events (
        contract_id, event_name, tx_hash, event_index, ledger_sequence, ledger_closed_at, topics, data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (tx_hash, event_index) DO NOTHING;
      `,
      [
        event.contractId,
        event.eventName,
        event.txHash,
        event.eventIndex,
        event.ledger,
        event.ledgerClosedAt,
        safeJsonStringify(event.topics),
        safeJsonStringify(event.data),
      ]
    );

    // 2. Update cached leases table to mirror on-chain state
    if (event.leaseId !== undefined) {
      await this.updateLeaseCache(client, event);
    }

    // 3. Fan-out to Lock Bridge & Notifications
    await this.fanOut(event);

    return true;
  }

  private async updateLeaseCache(client: pg.PoolClient | pg.ClientBase, event: ParsedEvent): Promise<void> {
    const leaseId = event.leaseId!.toString();
    const eventName = event.eventName;

    switch (eventName) {
      case "activated": {
        const startTs = Array.isArray(event.data) ? Number(event.data[0]) : Number(event.data || 0);
        await client.query(
          `UPDATE leases SET status = 'Active', start_ts = $1, updated_at = NOW() WHERE id = $2;`,
          [startTs, leaseId]
        );
        break;
      }
      case "payment": {
        // Data tuple: (amount, paid_total, next_due)
        if (Array.isArray(event.data) && event.data.length >= 2) {
          const paidTotal = String(event.data[1]);
          await client.query(
            `UPDATE leases SET paid = $1, updated_at = NOW() WHERE id = $2;`,
            [paidTotal, leaseId]
          );
        }
        break;
      }
      case "grace_entered": {
        await client.query(
          `UPDATE leases SET status = 'Grace', updated_at = NOW() WHERE id = $1;`,
          [leaseId]
        );
        break;
      }
      case "defaulted": {
        await client.query(
          `UPDATE leases SET status = 'Defaulted', updated_at = NOW() WHERE id = $1;`,
          [leaseId]
        );
        break;
      }
      case "cured": {
        await client.query(
          `UPDATE leases SET status = 'Active', updated_at = NOW() WHERE id = $1;`,
          [leaseId]
        );
        break;
      }
      case "completed": {
        await client.query(
          `UPDATE leases SET status = 'Completed', updated_at = NOW() WHERE id = $1;`,
          [leaseId]
        );
        break;
      }
      case "repossessed": {
        await client.query(
          `UPDATE leases SET status = 'Repossessed', updated_at = NOW() WHERE id = $1;`,
          [leaseId]
        );
        break;
      }
      case "cancelled": {
        await client.query(
          `UPDATE leases SET status = 'Cancelled', updated_at = NOW() WHERE id = $1;`,
          [leaseId]
        );
        break;
      }
      default:
        break;
    }
  }

  private async fanOut(event: ParsedEvent): Promise<void> {
    const { eventName, leaseId, txHash, ledger } = event;

    // Lock Bridge Fan-Out: defaulted, cured, completed, repossessed
    // Note: DO NOT issue lock commands directly (README discipline); send job to lock bridge!
    if (["defaulted", "cured", "completed", "repossessed"].includes(eventName) && this.lockBridgeQueue) {
      await this.lockBridgeQueue.add(
        `lock:${eventName}`,
        {
          eventName,
          leaseId: leaseId?.toString(),
          txHash,
          ledger,
          data: event.data,
        },
        { jobId: `${txHash}_${event.eventIndex}` }
      );
      this.logger.info("Fanned out event to Lock Bridge queue", { eventName, leaseId: leaseId?.toString() });
    }

    // Notifications Fan-Out: grace_entered, payment
    if (["grace_entered", "payment"].includes(eventName) && this.notificationQueue) {
      await this.notificationQueue.add(
        `notify:${eventName}`,
        {
          eventName,
          leaseId: leaseId?.toString(),
          data: event.data,
          ledger,
        },
        { jobId: `notify_${txHash}_${event.eventIndex}` }
      );
      this.logger.info("Fanned out event to Notifications queue", { eventName, leaseId: leaseId?.toString() });
    }
  }

  /**
   * Single polling iteration for new events.
   */
  async pollOnce(startLedger?: number): Promise<number> {
    let currentStart = startLedger;
    if (currentStart === undefined) {
      const storedCursor = await this.getStoredCursor();
      if (storedCursor !== null) {
        currentStart = storedCursor + 1;
      } else {
        try {
          const latest = await this.rpcServer.getLatestLedger();
          currentStart = Math.max(1, latest.sequence - 10);
        } catch {
          currentStart = 1;
        }
      }
    }

    this.logger.debug("Polling Soroban RPC events", { startLedger: currentStart });
    let eventsRes: rpc.Api.GetEventsResponse;
    try {
      eventsRes = await this.rpcServer.getEvents({
        startLedger: currentStart,
        filters: [{ type: "contract", contractIds: this.contractIds }],
      });
    } catch (err) {
      const msg = (err as Error).message;
      const match = msg.match(/ledger range:\s*(\d+)\s*-\s*(\d+)/);
      if (match) {
        const minLedger = parseInt(match[1], 10);
        this.logger.info("Adjusting startLedger to minimum available ledger range", { minLedger });
        return this.pollOnce(minLedger);
      }
      this.logger.warn("Error fetching events from Soroban RPC", { error: msg });
      return currentStart;
    }

    const events = eventsRes.events || [];
    if (events.length === 0) {
      return currentStart;
    }

    const client = await this.pgPool.connect();
    try {
      await client.query("BEGIN;");
      let maxLedgerProcessed = currentStart;

      for (let i = 0; i < events.length; i++) {
        const parsed = parseSorobanEvent(events[i], i);
        await this.processEvent(client, parsed);
        if (parsed.ledger > maxLedgerProcessed) {
          maxLedgerProcessed = parsed.ledger;
        }
      }

      await client.query("COMMIT;");
      this.logger.info(`Processed ${events.length} event(s) up to ledger ${maxLedgerProcessed}`);
      return maxLedgerProcessed + 1;
    } catch (err) {
      await client.query("ROLLBACK;");
      this.logger.error("Failed to process event batch, rolling back", { error: (err as Error).message });
      throw err;
    } finally {
      client.release();
    }
  }
}
