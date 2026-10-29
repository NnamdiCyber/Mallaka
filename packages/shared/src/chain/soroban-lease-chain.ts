import {
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
  Account,
} from "@stellar/stellar-sdk";
import { Queue, QueueEvents } from "bullmq";
import {
  decodeStatus,
  type ChainOperation,
  type KeyResolver,
  type LeaseChain,
  type LeaseSnapshot,
  type PreparedTx,
  type TxLookup,
  type TxOutcome,
  type TxSubmitter,
} from "./lease-chain.js";
import { DevSigner, type Signer } from "./signer.js";
import { AppError, ContractError } from "../errors.js";
import { extractContractErrorCode } from "./chain-client.js";

/** Queue name used by the sponsor service worker (services/sponsor/src/queue-worker.ts). */
const SPONSOR_TX_QUEUE_NAME = "sponsor-transactions";

/** Transactions are valid for 5 minutes; after that an unseen hash can never land. */
export const TX_VALIDITY_SECONDS = 300;

export interface SorobanLeaseChainOptions {
  rpcUrl: string;
  networkPassphrase: string;
  leaseContractId: string;
  keys: KeyResolver;
  submitter: TxSubmitter;
}

const i128 = (v: string) => nativeToScVal(BigInt(v), { type: "i128" });
const u64 = (v: string | number) => nativeToScVal(BigInt(v), { type: "u64" });
const addr = (v: string) => new Address(v).toScVal();

/**
 * Production LeaseChain backed by Soroban RPC.
 * - Reads are simulations only (no fee, no signature).
 * - Writes are built with the custodial party as the transaction source, so
 *   `require_auth` is satisfied by the source-account signature (ADR-008).
 * - Submission goes through the sponsor queue so riders never need XLM.
 *
 * NOT exercised against a live network in unit tests; see docs/testing notes.
 */
export class SorobanLeaseChain implements LeaseChain {
  private readonly server: rpc.Server;
  private readonly contract: Contract;

  constructor(private readonly opts: SorobanLeaseChainOptions) {
    this.server = new rpc.Server(opts.rpcUrl, { allowHttp: opts.rpcUrl.startsWith("http://") });
    this.contract = new Contract(opts.leaseContractId);
  }

  /** Read-only simulation of a contract call using a throwaway source account. */
  private async simulateRead(method: string, ...args: xdr.ScVal[]): Promise<unknown> {
    const source = new Account(Keypair.random().publicKey(), "0");
    const tx = new TransactionBuilder(source, {
      fee: "100",
      networkPassphrase: this.opts.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      const code = extractContractErrorCode(sim.error);
      if (code !== null) throw ContractError.fromCode(code);
      throw new AppError(`Chain read failed: ${sim.error}`, 502, "CHAIN_UNAVAILABLE");
    }
    if (!sim.result) throw new AppError("Chain read returned no result", 502, "CHAIN_UNAVAILABLE");
    return scValToNative(sim.result.retval);
  }

  async getSnapshot(leaseId: string): Promise<LeaseSnapshot> {
    const [lease, view] = await Promise.all([
      this.simulateRead("get_lease", u64(leaseId)),
      this.simulateRead("get_status", u64(leaseId)),
    ]);
    const l = lease as Record<string, unknown>;
    const v = view as Record<string, unknown>;
    const storedStatus = decodeStatus(v.stored_status);
    // Schedule derivation (Active/Grace/Defaulted/Completed) only applies once a lease has been activated.
    // On-chain get_status calls derive_status with start_ts = 0 for Pending leases, which would otherwise read as Defaulted.
    const scheduleActive = storedStatus === "Active" || storedStatus === "Grace" || storedStatus === "Defaulted";
    const derivedStatus = scheduleActive ? decodeStatus(v.derived_status) : storedStatus;
    return {
      id: leaseId,
      lessor: String(l.lessor),
      lessee: String(l.lessee),
      derivedStatus,
      storedStatus,
      totalPrice: String(l.total_price),
      deposit: String(l.deposit),
      installment: String(l.installment),
      intervalSeconds: Number(l.interval),
      graceSeconds: Number(l.grace),
      paid: String(l.paid),
      startTs: Number(l.start_ts),
      nextDue: scheduleActive ? Number(v.next_due) : 0,
      remainingBalance: String(v.remaining_balance),
      arrears: scheduleActive ? String(v.arrears) : "0",
      readAt: Math.floor(Date.now() / 1000),
    };
  }

  async prepare(op: ChainOperation): Promise<PreparedTx> {
    const { sourceAddress, call } = this.buildCall(op);
    const signer = await this.opts.keys.signerFor(sourceAddress);
    const account = await this.server.getAccount(sourceAddress);

    const raw = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this.opts.networkPassphrase,
    })
      .addOperation(call)
      .setTimeout(TX_VALIDITY_SECONDS)
      .build();

    // ALWAYS simulate before submitting (README 9).
    const sim = await this.server.simulateTransaction(raw);
    if (rpc.Api.isSimulationError(sim)) {
      const code = extractContractErrorCode(sim.error);
      if (code !== null) throw ContractError.fromCode(code);
      throw new AppError(`Simulation failed: ${sim.error}`, 400, "SIMULATION_FAILED");
    }
    const assembled = rpc.assembleTransaction(raw, sim).build();
    await signer.signTransaction(assembled);
    return {
      txHash: Buffer.from(assembled.hash()).toString("hex"),
      txXdr: assembled.toXDR(),
    };
  }

  private buildCall(op: ChainOperation): { sourceAddress: string; call: xdr.Operation } {
    switch (op.kind) {
      case "pay":
        return {
          sourceAddress: op.payer,
          call: this.contract.call("pay", u64(op.leaseId), addr(op.payer), i128(op.amount)),
        };
      case "activate":
        return { sourceAddress: op.lessee, call: this.contract.call("activate", u64(op.leaseId)) };
      case "create_lease":
        return {
          sourceAddress: op.lessor,
          call: this.contract.call(
            "create_lease",
            addr(op.lessor),
            addr(op.lessee),
            nativeToScVal(Buffer.from(op.assetIdHex, "hex"), { type: "bytes" }),
            addr(op.titleContract),
            addr(op.token),
            i128(op.totalPrice),
            i128(op.deposit),
            i128(op.installment),
            u64(op.intervalSeconds),
            u64(op.graceSeconds),
          ),
        };
    }
  }

  async submit(prepared: PreparedTx): Promise<TxOutcome> {
    const out = await this.opts.submitter.submit(prepared.txXdr);
    let val = out.returnValue;
    if (val instanceof xdr.ScVal) {
      val = scValToNative(val as xdr.ScVal);
    } else if (val !== undefined && val !== null && typeof val === "object") {
      // BullMQ JSON-serializes xdr.ScVal instances; read the canonical ScVal from RPC by txHash.
      const tx = await this.server.getTransaction(out.txHash);
      if (tx.status === rpc.Api.GetTransactionStatus.SUCCESS && tx.returnValue) {
        val = scValToNative(tx.returnValue);
      }
    }
    return { txHash: out.txHash, returnValue: val };
  }

  async lookup(txHash: string): Promise<TxLookup> {
    const res = await this.server.getTransaction(txHash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) return "SUCCESS";
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) return "FAILED";
    return "NOT_FOUND";
  }
}

/**
 * Submits through the sponsor service's BullMQ queue and waits for the result.
 * The sponsor simulates, fee-bumps, submits and polls to finality.
 * Requires REDIS_URL. Not covered by unit tests (needs Redis).
 */
export class SponsorQueueSubmitter implements TxSubmitter {
  private readonly queue: Queue;
  private readonly events: QueueEvents;

  constructor(redisUrl: string, private readonly timeoutMs = 120_000) {
    this.queue = new Queue(SPONSOR_TX_QUEUE_NAME, { connection: { url: redisUrl } });
    this.events = new QueueEvents(SPONSOR_TX_QUEUE_NAME, { connection: { url: redisUrl } });
  }

  async submit(txXdr: string): Promise<TxOutcome> {
    const job = await this.queue.add("submit", { txXdr });
    const result = (await job.waitUntilFinished(this.events, this.timeoutMs)) as {
      txHash: string;
      returnValue?: unknown;
    };
    return { txHash: result.txHash, returnValue: result.returnValue };
  }

  async close(): Promise<void> {
    await this.events.close();
    await this.queue.close();
  }
}

/**
 * Development-only key resolver for testnet (ADR-008, ADR-010). Secrets come
 * from DEV_SIGNER_SECRETS (comma separated). Refuses to run on mainnet, where a
 * KMS/Vault-backed resolver must be supplied instead.
 */
export class DevKeyResolver implements KeyResolver {
  private readonly signers = new Map<string, Signer>();

  constructor(secrets: string[], network: string) {
    if (network === "mainnet") {
      throw new Error("DevKeyResolver is forbidden on mainnet. Use a KMS/Vault-backed KeyResolver.");
    }
    for (const secret of secrets.filter(Boolean)) {
      this.signers.set(Keypair.fromSecret(secret).publicKey(), new DevSigner(secret, network));
    }
  }

  async signerFor(address: string): Promise<Signer> {
    const s = this.signers.get(address);
    if (!s) throw new AppError("No custodial signer available for this account", 500, "NO_SIGNER");
    return s;
  }
}

export function devKeyResolverFromEnv(network: string, env: NodeJS.ProcessEnv = process.env): DevKeyResolver {
  return new DevKeyResolver((env.DEV_SIGNER_SECRETS ?? "").split(","), network);
}
