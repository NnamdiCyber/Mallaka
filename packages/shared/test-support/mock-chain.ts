import crypto from "node:crypto";
import { ContractError } from "../src/errors.js";
import type {
  ChainOperation,
  LeaseChain,
  LeaseSnapshot,
  LeaseStatusName,
  PreparedTx,
  TxLookup,
  TxOutcome,
} from "../src/chain/lease-chain.js";

/**
 * In-memory chain for tests. Models what matters to the services: lease state,
 * transaction landing by hash (idempotent), overpayment rejection, RPC outage,
 * and "submit failed but the transaction actually landed" timeouts.
 */
export class MockLeaseChain implements LeaseChain {
  leases = new Map<string, LeaseSnapshot>();
  /** Transactions that landed on chain, by hash. */
  landed = new Map<string, ChainOperation>();
  prepared = new Map<string, ChainOperation>();
  /** Every `pay` actually applied to a lease (for double-pay assertions). */
  applied: { leaseId: string; amount: bigint }[] = [];
  rpcDown = false;
  /** Number of upcoming submit calls that fail BEFORE the tx lands. */
  failBeforeLanding = 0;
  /** Number of upcoming submit calls that land the tx and THEN throw (timeout). */
  failAfterLanding = 0;
  prepareCalls = 0;
  nextLeaseId = 100;

  addLease(partial: Partial<LeaseSnapshot> & { id: string }): LeaseSnapshot {
    const lease: LeaseSnapshot = {
      lessor: "GLESSOR",
      lessee: "GRIDER",
      derivedStatus: "Active",
      storedStatus: "Active",
      totalPrice: "1000000000",
      deposit: "100000000",
      installment: "100000000",
      intervalSeconds: 86400,
      graceSeconds: 172800,
      paid: "0",
      startTs: 1000,
      nextDue: 87400,
      remainingBalance: "900000000",
      arrears: "0",
      readAt: 0,
      ...partial,
    };
    this.leases.set(lease.id, lease);
    return lease;
  }

  setStatus(id: string, status: LeaseStatusName): void {
    const l = this.leases.get(id)!;
    l.derivedStatus = status;
    l.storedStatus = status;
  }

  async getSnapshot(leaseId: string): Promise<LeaseSnapshot> {
    if (this.rpcDown) throw new Error("RPC unavailable");
    const l = this.leases.get(leaseId);
    if (!l) throw ContractError.fromCode(1);
    return { ...l };
  }

  async prepare(op: ChainOperation): Promise<PreparedTx> {
    if (this.rpcDown) throw new Error("RPC unavailable");
    this.prepareCalls++;
    const txHash = crypto.randomBytes(32).toString("hex");
    this.prepared.set(txHash, op);
    return { txHash, txXdr: `xdr:${txHash}` };
  }

  private land(txHash: string): TxOutcome {
    if (this.landed.has(txHash)) return { txHash }; // network dedupes by hash
    const op = this.prepared.get(txHash)!;
    let returnValue: unknown;
    if (op.kind === "pay") {
      const l = this.leases.get(op.leaseId)!;
      const amount = BigInt(op.amount);
      if (amount > BigInt(l.remainingBalance)) throw ContractError.fromCode(9); // Overpayment
      l.remainingBalance = (BigInt(l.remainingBalance) - amount).toString();
      l.paid = (BigInt(l.paid) + amount).toString();
      if (BigInt(l.remainingBalance) === 0n) this.setStatus(op.leaseId, "Completed");
      this.applied.push({ leaseId: op.leaseId, amount });
    } else if (op.kind === "activate") {
      this.setStatus(op.leaseId, "Active");
    } else {
      const id = String(this.nextLeaseId++);
      this.addLease({ id, derivedStatus: "Pending", storedStatus: "Pending", lessor: op.lessor, lessee: op.lessee });
      returnValue = BigInt(id);
    }
    this.landed.set(txHash, op);
    return { txHash, returnValue };
  }

  async submit(prepared: PreparedTx): Promise<TxOutcome> {
    if (this.rpcDown) throw new Error("RPC unavailable");
    if (this.failBeforeLanding > 0) {
      this.failBeforeLanding--;
      throw new Error("network error before landing");
    }
    const outcome = this.land(prepared.txHash);
    if (this.failAfterLanding > 0) {
      this.failAfterLanding--;
      throw new Error("poll timeout (transaction actually landed)");
    }
    return outcome;
  }

  async lookup(txHash: string): Promise<TxLookup> {
    if (this.rpcDown) throw new Error("RPC unavailable");
    return this.landed.has(txHash) ? "SUCCESS" : "NOT_FOUND";
  }
}
