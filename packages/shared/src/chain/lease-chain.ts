import type { Signer } from "./signer.js";

/**
 * Chain abstractions shared by api, payments and lock-bridge.
 *
 * The contract is the source of truth (README section 1): every service reads
 * lease state through `LeaseChain.getSnapshot` and never invents it. The
 * interface exists so tests can run against a mocked chain while production
 * wires in `SorobanLeaseChain`.
 */

export type LeaseStatusName =
  | "Pending"
  | "Active"
  | "Grace"
  | "Defaulted"
  | "Completed"
  | "Repossessed"
  | "Cancelled";

/** Live lease state read from the contract (get_lease + get_status). All amounts are token base units. */
export interface LeaseSnapshot {
  id: string;
  lessor: string;
  lessee: string;
  /** Status derived from ledger time (README 8.2). This is what enforcement decisions use (ADR-005). */
  derivedStatus: LeaseStatusName;
  storedStatus: LeaseStatusName;
  totalPrice: string;
  deposit: string;
  installment: string;
  intervalSeconds: number;
  graceSeconds: number;
  paid: string;
  startTs: number;
  nextDue: number;
  remainingBalance: string;
  arrears: string;
  /** Ledger close time the snapshot was read at (unix seconds), when known. */
  readAt: number;
}

/** A state-changing call to build for a custodial party (ADR-008). */
export type ChainOperation =
  | { kind: "pay"; leaseId: string; payer: string; amount: string }
  | { kind: "activate"; leaseId: string; lessee: string }
  | {
      kind: "create_lease";
      lessor: string;
      lessee: string;
      assetIdHex: string;
      titleContract: string;
      token: string;
      totalPrice: string;
      deposit: string;
      installment: string;
      intervalSeconds: number;
      graceSeconds: number;
    };

/** A fully signed (by the custodial party) transaction, not yet submitted. */
export interface PreparedTx {
  txHash: string;
  txXdr: string;
}

export type TxLookup = "SUCCESS" | "FAILED" | "NOT_FOUND";

export interface TxOutcome {
  txHash: string;
  /** Present for create_lease: the new on-chain lease id. */
  returnValue?: unknown;
}

export interface LeaseChain {
  /** Throws if the chain cannot be reached. Callers that enforce things must FAIL OPEN on throw. */
  getSnapshot(leaseId: string): Promise<LeaseSnapshot>;
  /** Builds and signs the transaction with the custodial party. Never submits. */
  prepare(op: ChainOperation): Promise<PreparedTx>;
  /** Routes the prepared transaction through the sponsor and resolves once it is final. Throws on failure. */
  submit(prepared: PreparedTx): Promise<TxOutcome>;
  /** Looks a transaction up by hash. Used to resolve unknown outcomes without re-paying. */
  lookup(txHash: string): Promise<TxLookup>;
}

/** Resolves the custodial signer for an address (ADR-008). Keys never leave KMS in production. */
export interface KeyResolver {
  signerFor(address: string): Promise<Signer>;
}

/** Routes a signed transaction through the sponsor service (fee-bump), README 5 and 12. */
export interface TxSubmitter {
  submit(txXdr: string): Promise<TxOutcome>;
}

const STATUS_BY_INDEX: LeaseStatusName[] = [
  "Pending",
  "Active",
  "Grace",
  "Defaulted",
  "Completed",
  "Repossessed",
  "Cancelled",
];

/** The contract status enum decodes either as a number or as a one-element symbol array. */
export function decodeStatus(raw: unknown): LeaseStatusName {
  if (typeof raw === "number") {
    const s = STATUS_BY_INDEX[raw];
    if (s) return s;
  }
  if (Array.isArray(raw) && typeof raw[0] === "string" && STATUS_BY_INDEX.includes(raw[0] as LeaseStatusName)) {
    return raw[0] as LeaseStatusName;
  }
  if (typeof raw === "string" && STATUS_BY_INDEX.includes(raw as LeaseStatusName)) {
    return raw as LeaseStatusName;
  }
  throw new Error(`Unrecognised lease status from chain: ${JSON.stringify(raw)}`);
}
