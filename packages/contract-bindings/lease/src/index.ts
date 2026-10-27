import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CDNKLGLDN64SFB3WIOVAMA7Q4LILLO2H27HWIXFTXTXTK7UO5ERF5TJE",
  }
} as const


export interface Lease {
  asset_id: Buffer;
  deposit: i128;
  grace: u64;
  id: u64;
  installment: i128;
  interval: u64;
  lessee: string;
  lessor: string;
  paid: i128;
  /**
 * Minimum seconds after default before repossession is allowed.
 * Added per ADR-002.
 */
repossession_wait: u64;
  start_ts: u64;
  status: Status;
  title_contract: string;
  token: string;
  total_price: i128;
}


export interface Terms {
  deposit: i128;
  grace: u64;
  installment: i128;
  interval: u64;
  total_price: i128;
}

export enum Status {
  Pending = 0,
  Active = 1,
  Grace = 2,
  Defaulted = 3,
  Completed = 4,
  Repossessed = 5,
  Cancelled = 6,
}


export interface LeaseView {
  arrears: i128;
  derived_status: Status;
  lease_id: u64;
  next_due: u64;
  remaining_balance: i128;
  stored_status: Status;
}

export const Errors = {
  1: {message:"NotFound"},
  2: {message:"Unauthorized"},
  3: {message:"InvalidTerms"},
  4: {message:"InvalidState"},
  5: {message:"InvalidAmount"},
  6: {message:"AlreadyActive"},
  7: {message:"NotDefaulted"},
  8: {message:"RepossessionTooEarly"},
  9: {message:"Overpayment"},
  10: {message:"MathOverflow"}
}


/**
 * Topics for cured: [lease_id]
 * Data: paid_total
 */
export interface CuredData {
  paid_total: i128;
}


/**
 * Topics for payment: [lease_id, payer]
 * Data: amount, paid_total, next_due
 */
export interface PaymentData {
  amount: i128;
  next_due: u64;
  paid_total: i128;
}


/**
 * Topics for activated: [lease_id]
 * Data: start_ts, deposit
 */
export interface ActivatedData {
  deposit: i128;
  start_ts: u64;
}


/**
 * Topics for cancelled: [lease_id]
 * Data: ts
 */
export interface CancelledData {
  ts: u64;
}


/**
 * Topics for completed: [lease_id, lessee]
 * Data: final_paid
 */
export interface CompletedData {
  final_paid: i128;
}


/**
 * Topics for defaulted: [lease_id]
 * Data: arrears
 */
export interface DefaultedData {
  arrears: i128;
}


/**
 * Topics for repossessed: [lease_id]
 * Data: ts
 */
export interface RepossessedData {
  ts: u64;
}


/**
 * Topics for grace_entered: [lease_id]
 * Data: due_ts, grace_ends
 */
export interface GraceEnteredData {
  due_ts: u64;
  grace_ends: u64;
}

export interface Client {
  /**
   * Construct and simulate a pay transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Make a payment. Called by any payer.
   */
  pay: ({lease_id, payer, amount}: {lease_id: u64, payer: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a cancel transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cancel a pending lease. Called by lessor.
   */
  cancel: ({lease_id}: {lease_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a activate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Activate a pending lease. Called by the lessee.
   */
  activate: ({lease_id}: {lease_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_lease transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get lease by ID. Read-only.
   */
  get_lease: ({lease_id}: {lease_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Lease>>

  /**
   * Construct and simulate a repossess transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Repossess a defaulted lease. Called by lessor after minimum period.
   */
  repossess: ({lease_id}: {lease_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a extend_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend TTL for a lease. Permissionless.
   */
  extend_ttl: ({lease_id}: {lease_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get lease status view. Read-only.
   */
  get_status: ({lease_id}: {lease_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<LeaseView>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initialize the contract with admin and protocol version.
   */
  initialize: ({admin}: {admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a create_lease transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a new lease. Called by the lessor.
   */
  create_lease: ({lessor, lessee, asset_id, title_contract, token, total_price, deposit, installment, interval, grace}: {lessor: string, lessee: string, asset_id: Buffer, title_contract: string, token: string, total_price: i128, deposit: i128, installment: i128, interval: u64, grace: u64}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a check_default transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Check for default. Permissionless. Idempotent.
   */
  check_default: ({lease_id}: {lease_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Status>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAACRNYWtlIGEgcGF5bWVudC4gQ2FsbGVkIGJ5IGFueSBwYXllci4AAAADcGF5AAAAAAMAAAAAAAAACGxlYXNlX2lkAAAABgAAAAAAAAAFcGF5ZXIAAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAClDYW5jZWwgYSBwZW5kaW5nIGxlYXNlLiBDYWxsZWQgYnkgbGVzc29yLgAAAAAAAAZjYW5jZWwAAAAAAAEAAAAAAAAACGxlYXNlX2lkAAAABgAAAAA=",
        "AAAAAAAAAC9BY3RpdmF0ZSBhIHBlbmRpbmcgbGVhc2UuIENhbGxlZCBieSB0aGUgbGVzc2VlLgAAAAAIYWN0aXZhdGUAAAABAAAAAAAAAAhsZWFzZV9pZAAAAAYAAAAA",
        "AAAAAAAAABtHZXQgbGVhc2UgYnkgSUQuIFJlYWQtb25seS4AAAAACWdldF9sZWFzZQAAAAAAAAEAAAAAAAAACGxlYXNlX2lkAAAABgAAAAEAAAfQAAAABUxlYXNlAAAA",
        "AAAAAAAAAENSZXBvc3Nlc3MgYSBkZWZhdWx0ZWQgbGVhc2UuIENhbGxlZCBieSBsZXNzb3IgYWZ0ZXIgbWluaW11bSBwZXJpb2QuAAAAAAlyZXBvc3Nlc3MAAAAAAAABAAAAAAAAAAhsZWFzZV9pZAAAAAYAAAAA",
        "AAAAAAAAACdFeHRlbmQgVFRMIGZvciBhIGxlYXNlLiBQZXJtaXNzaW9ubGVzcy4AAAAACmV4dGVuZF90dGwAAAAAAAEAAAAAAAAACGxlYXNlX2lkAAAABgAAAAA=",
        "AAAAAAAAACFHZXQgbGVhc2Ugc3RhdHVzIHZpZXcuIFJlYWQtb25seS4AAAAAAAAKZ2V0X3N0YXR1cwAAAAAAAQAAAAAAAAAIbGVhc2VfaWQAAAAGAAAAAQAAB9AAAAAJTGVhc2VWaWV3AAAA",
        "AAAAAAAAADhJbml0aWFsaXplIHRoZSBjb250cmFjdCB3aXRoIGFkbWluIGFuZCBwcm90b2NvbCB2ZXJzaW9uLgAAAAppbml0aWFsaXplAAAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAA",
        "AAAAAAAAAClDcmVhdGUgYSBuZXcgbGVhc2UuIENhbGxlZCBieSB0aGUgbGVzc29yLgAAAAAAAAxjcmVhdGVfbGVhc2UAAAAKAAAAAAAAAAZsZXNzb3IAAAAAABMAAAAAAAAABmxlc3NlZQAAAAAAEwAAAAAAAAAIYXNzZXRfaWQAAAPuAAAAIAAAAAAAAAAOdGl0bGVfY29udHJhY3QAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAALdG90YWxfcHJpY2UAAAAACwAAAAAAAAAHZGVwb3NpdAAAAAALAAAAAAAAAAtpbnN0YWxsbWVudAAAAAALAAAAAAAAAAhpbnRlcnZhbAAAAAYAAAAAAAAABWdyYWNlAAAAAAAABgAAAAEAAAAG",
        "AAAAAAAAAC5DaGVjayBmb3IgZGVmYXVsdC4gUGVybWlzc2lvbmxlc3MuIElkZW1wb3RlbnQuAAAAAAANY2hlY2tfZGVmYXVsdAAAAAAAAAEAAAAAAAAACGxlYXNlX2lkAAAABgAAAAEAAAfQAAAABlN0YXR1cwAA",
        "AAAAAQAAAAAAAAAAAAAABUxlYXNlAAAAAAAADwAAAAAAAAAIYXNzZXRfaWQAAAPuAAAAIAAAAAAAAAAHZGVwb3NpdAAAAAALAAAAAAAAAAVncmFjZQAAAAAAAAYAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAAtpbnN0YWxsbWVudAAAAAALAAAAAAAAAAhpbnRlcnZhbAAAAAYAAAAAAAAABmxlc3NlZQAAAAAAEwAAAAAAAAAGbGVzc29yAAAAAAATAAAAAAAAAARwYWlkAAAACwAAAFBNaW5pbXVtIHNlY29uZHMgYWZ0ZXIgZGVmYXVsdCBiZWZvcmUgcmVwb3NzZXNzaW9uIGlzIGFsbG93ZWQuCkFkZGVkIHBlciBBRFItMDAyLgAAABFyZXBvc3Nlc3Npb25fd2FpdAAAAAAAAAYAAAAAAAAACHN0YXJ0X3RzAAAABgAAAAAAAAAGc3RhdHVzAAAAAAfQAAAABlN0YXR1cwAAAAAAAAAAAA50aXRsZV9jb250cmFjdAAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAt0b3RhbF9wcmljZQAAAAAL",
        "AAAAAQAAAAAAAAAAAAAABVRlcm1zAAAAAAAABQAAAAAAAAAHZGVwb3NpdAAAAAALAAAAAAAAAAVncmFjZQAAAAAAAAYAAAAAAAAAC2luc3RhbGxtZW50AAAAAAsAAAAAAAAACGludGVydmFsAAAABgAAAAAAAAALdG90YWxfcHJpY2UAAAAACw==",
        "AAAAAwAAAAAAAAAAAAAABlN0YXR1cwAAAAAABwAAAAAAAAAHUGVuZGluZwAAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAEAAAAAAAAABUdyYWNlAAAAAAAAAgAAAAAAAAAJRGVmYXVsdGVkAAAAAAAAAwAAAAAAAAAJQ29tcGxldGVkAAAAAAAABAAAAAAAAAALUmVwb3NzZXNzZWQAAAAABQAAAAAAAAAJQ2FuY2VsbGVkAAAAAAAABg==",
        "AAAAAQAAAAAAAAAAAAAACUxlYXNlVmlldwAAAAAAAAYAAAAAAAAAB2FycmVhcnMAAAAACwAAAAAAAAAOZGVyaXZlZF9zdGF0dXMAAAAAB9AAAAAGU3RhdHVzAAAAAAAAAAAACGxlYXNlX2lkAAAABgAAAAAAAAAIbmV4dF9kdWUAAAAGAAAAAAAAABFyZW1haW5pbmdfYmFsYW5jZQAAAAAAAAsAAAAAAAAADXN0b3JlZF9zdGF0dXMAAAAAAAfQAAAABlN0YXR1cwAA",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACgAAAAAAAAAITm90Rm91bmQAAAABAAAAAAAAAAxVbmF1dGhvcml6ZWQAAAACAAAAAAAAAAxJbnZhbGlkVGVybXMAAAADAAAAAAAAAAxJbnZhbGlkU3RhdGUAAAAEAAAAAAAAAA1JbnZhbGlkQW1vdW50AAAAAAAABQAAAAAAAAANQWxyZWFkeUFjdGl2ZQAAAAAAAAYAAAAAAAAADE5vdERlZmF1bHRlZAAAAAcAAAAAAAAAFFJlcG9zc2Vzc2lvblRvb0Vhcmx5AAAACAAAAAAAAAALT3ZlcnBheW1lbnQAAAAACQAAAAAAAAAMTWF0aE92ZXJmbG93AAAACg==",
        "AAAAAQAAAC1Ub3BpY3MgZm9yIGN1cmVkOiBbbGVhc2VfaWRdCkRhdGE6IHBhaWRfdG90YWwAAAAAAAAAAAAACUN1cmVkRGF0YQAAAAAAAAEAAAAAAAAACnBhaWRfdG90YWwAAAAAAAs=",
        "AAAAAQAAAEhUb3BpY3MgZm9yIHBheW1lbnQ6IFtsZWFzZV9pZCwgcGF5ZXJdCkRhdGE6IGFtb3VudCwgcGFpZF90b3RhbCwgbmV4dF9kdWUAAAAAAAAAC1BheW1lbnREYXRhAAAAAAMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAIbmV4dF9kdWUAAAAGAAAAAAAAAApwYWlkX3RvdGFsAAAAAAAL",
        "AAAAAQAAADhUb3BpY3MgZm9yIGFjdGl2YXRlZDogW2xlYXNlX2lkXQpEYXRhOiBzdGFydF90cywgZGVwb3NpdAAAAAAAAAANQWN0aXZhdGVkRGF0YQAAAAAAAAIAAAAAAAAAB2RlcG9zaXQAAAAACwAAAAAAAAAIc3RhcnRfdHMAAAAG",
        "AAAAAQAAAClUb3BpY3MgZm9yIGNhbmNlbGxlZDogW2xlYXNlX2lkXQpEYXRhOiB0cwAAAAAAAAAAAAANQ2FuY2VsbGVkRGF0YQAAAAAAAAEAAAAAAAAAAnRzAAAAAAAG",
        "AAAAAQAAADlUb3BpY3MgZm9yIGNvbXBsZXRlZDogW2xlYXNlX2lkLCBsZXNzZWVdCkRhdGE6IGZpbmFsX3BhaWQAAAAAAAAAAAAADUNvbXBsZXRlZERhdGEAAAAAAAABAAAAAAAAAApmaW5hbF9wYWlkAAAAAAAL",
        "AAAAAQAAAC5Ub3BpY3MgZm9yIGRlZmF1bHRlZDogW2xlYXNlX2lkXQpEYXRhOiBhcnJlYXJzAAAAAAAAAAAADURlZmF1bHRlZERhdGEAAAAAAAABAAAAAAAAAAdhcnJlYXJzAAAAAAs=",
        "AAAAAQAAACtUb3BpY3MgZm9yIHJlcG9zc2Vzc2VkOiBbbGVhc2VfaWRdCkRhdGE6IHRzAAAAAAAAAAAPUmVwb3NzZXNzZWREYXRhAAAAAAEAAAAAAAAAAnRzAAAAAAAG",
        "AAAAAQAAAD1Ub3BpY3MgZm9yIGdyYWNlX2VudGVyZWQ6IFtsZWFzZV9pZF0KRGF0YTogZHVlX3RzLCBncmFjZV9lbmRzAAAAAAAAAAAAABBHcmFjZUVudGVyZWREYXRhAAAAAgAAAAAAAAAGZHVlX3RzAAAAAAAGAAAAAAAAAApncmFjZV9lbmRzAAAAAAAG" ]),
      options
    )
  }
  public readonly fromJSON = {
    pay: this.txFromJSON<null>,
        cancel: this.txFromJSON<null>,
        activate: this.txFromJSON<null>,
        get_lease: this.txFromJSON<Lease>,
        repossess: this.txFromJSON<null>,
        extend_ttl: this.txFromJSON<null>,
        get_status: this.txFromJSON<LeaseView>,
        initialize: this.txFromJSON<null>,
        create_lease: this.txFromJSON<u64>,
        check_default: this.txFromJSON<Status>
  }
}