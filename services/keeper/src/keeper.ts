import pg from "pg";
import {
  ChainClient,
  Logger,
  createLogger,
  Signer,
  DevSigner,
} from "@mallaka/shared";
import {
  Transaction,
  TransactionBuilder,
  Account,
  Networks,
  Address,
  Operation,
  xdr,
} from "@stellar/stellar-sdk";

export interface KeeperOptions {
  pgPool: pg.Pool;
  chainClient: ChainClient;
  leaseContractId: string;
  networkPassphrase?: string;
  keeperSigner?: Signer;
  logger?: Logger;
}

export interface CandidateLease {
  id: string; // bigint
  status: string;
  start_ts: string; // u64
  paid: string; // i128
  installment: string; // i128
  interval_seconds: string; // u64
  grace_period_seconds: string; // u64
}

export class KeeperService {
  private readonly pgPool: pg.Pool;
  private readonly chainClient: ChainClient;
  private readonly leaseContractId: string;
  private readonly networkPassphrase: string;
  private readonly keeperSigner?: Signer;
  private readonly logger: Logger;

  constructor(options: KeeperOptions) {
    this.pgPool = options.pgPool;
    this.chainClient = options.chainClient;
    this.leaseContractId = options.leaseContractId;
    this.networkPassphrase = options.networkPassphrase ?? Networks.TESTNET;
    this.keeperSigner = options.keeperSigner;
    this.logger = options.logger ?? createLogger("keeper");
  }

  /**
   * Scans leases in Postgres that are near or past due and executes check_default.
   * Isolated per-lease error handling ensures that a failure on one lease never blocks others.
   */
  async scanAndCheckDefaults(nowTimestampSeconds?: number): Promise<{ processed: number; errors: number }> {
    const now = nowTimestampSeconds ?? Math.floor(Date.now() / 1000);
    this.logger.debug("Scanning leases for check_default", { now });

    // Select Active and Grace leases that have activated (start_ts > 0)
    const res = await this.pgPool.query<CandidateLease>(`
      SELECT id, status, start_ts, paid, installment, interval_seconds, grace_period_seconds
      FROM leases
      WHERE status IN ('Active', 'Grace') AND start_ts > 0;
    `);

    let processed = 0;
    let errors = 0;

    for (const lease of res.rows) {
      try {
        const startTs = Number(lease.start_ts);
        const paid = BigInt(lease.paid);
        const installment = BigInt(lease.installment);
        const interval = Number(lease.interval_seconds);

        if (installment <= 0n || interval <= 0) {
          continue;
        }

        // covered = floor(paid / installment)
        const covered = paid / installment;
        // next_due = start_ts + (covered + 1) * interval
        const nextDue = startTs + Number(covered + 1n) * interval;

        // Overdue condition: now > nextDue
        if (now > nextDue) {
          this.logger.info("Lease is overdue, triggering check_default on-chain", {
            leaseId: lease.id,
            status: lease.status,
            nextDue,
            now,
          });

          await this.invokeCheckDefault(BigInt(lease.id));
          processed++;
        }
      } catch (err) {
        errors++;
        // ISOLATED PER-LEASE ERROR HANDLING: log and continue to next lease
        this.logger.error("Failed to process check_default for lease", {
          leaseId: lease.id,
          error: (err as Error).message,
        });
      }
    }

    return { processed, errors };
  }

  /**
   * Scans non-terminal leases and bumps storage TTL on-chain.
   * Isolated per-lease error handling ensures resilience.
   */
  async scanAndExtendTtls(): Promise<{ processed: number; errors: number }> {
    this.logger.debug("Scanning leases for TTL extension");

    // Select non-terminal leases (Pending, Active, Grace, Defaulted)
    const res = await this.pgPool.query<{ id: string }>(`
      SELECT id FROM leases
      WHERE status IN ('Pending', 'Active', 'Grace', 'Defaulted');
    `);

    let processed = 0;
    let errors = 0;

    for (const lease of res.rows) {
      try {
        await this.invokeExtendTtl(BigInt(lease.id));
        processed++;
      } catch (err) {
        errors++;
        // ISOLATED ERROR HANDLING
        this.logger.error("Failed to extend TTL for lease", {
          leaseId: lease.id,
          error: (err as Error).message,
        });
      }
    }

    return { processed, errors };
  }

  /**
   * Builds, simulates, and submits a permissionless check_default transaction.
   * ALWAYS simulates before submitting (README Section 9).
   */
  async invokeCheckDefault(leaseId: bigint): Promise<void> {
    const tx = await this.buildContractCallTx("check_default", [
      xdr.ScVal.scvU64(leaseId),
    ]);

    // chainClient.submitAndPoll simulates first!
    await this.chainClient.submitAndPoll(tx);
  }

  /**
   * Builds, simulates, and submits a permissionless extend_ttl transaction.
   */
  async invokeExtendTtl(leaseId: bigint): Promise<void> {
    const tx = await this.buildContractCallTx("extend_ttl", [
      xdr.ScVal.scvU64(leaseId),
    ]);

    await this.chainClient.submitAndPoll(tx);
  }

  private async buildContractCallTx(functionName: string, args: xdr.ScVal[]): Promise<Transaction> {
    const keeperPubKey = this.keeperSigner
      ? await this.keeperSigner.getPublicKey()
      : "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVTHZ";

    const account = new Account(keeperPubKey, "1");

    const callOp = Operation.invokeContractFunction({
      contract: this.leaseContractId,
      function: functionName,
      args,
    });

    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(callOp)
      .build();

    if (this.keeperSigner) {
      await this.keeperSigner.signTransaction(tx);
    }

    return tx;
  }
}
