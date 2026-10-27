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
    contractId: "CA52GFT2QVCTE7JS4KVMB2RK2SDSXJEG5D3DM24R3CA2VLWMWWM3I5VV",
  }
} as const


export interface TitleEntry {
  asset_id: Buffer;
  custodian: Option<string>;
  owner: string;
}


export interface AssetRecord {
  asset_id: Buffer;
  hash: Buffer;
}

export const Errors = {
  1: {message:"NotFound"},
  2: {message:"Unauthorized"},
  3: {message:"AlreadyRegistered"},
  4: {message:"NotOwner"},
  5: {message:"InvalidState"}
}

export interface Client {
  /**
   * Construct and simulate a owner_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get the owner of an asset.
   */
  owner_of: ({asset_id}: {asset_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a register transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register an asset title under an owner. Fails if already registered.
   */
  register: ({asset_id, owner}: {asset_id: Buffer, owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfer an asset title. Requires auth from owner (if not in escrow) or custodian (if in escrow).
   */
  transfer: ({asset_id, from, to}: {asset_id: Buffer, from: string, to: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_entry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get the full entry for an asset.
   */
  get_entry: ({asset_id}: {asset_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<TitleEntry>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initialize the contract with an admin address.
   */
  initialize: ({admin}: {admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_custodian transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set an escrow custodian for an asset.
   * When no custodian is set, only the owner can call this.
   * When a custodian is already set, only that custodian can change it.
   */
  set_custodian: ({asset_id, custodian}: {asset_id: Buffer, custodian: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a clear_custodian transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Clear the escrow custodian for an asset.
   * When a custodian is set (escrow active), only the custodian can clear it.
   * Otherwise, the owner can call this.
   */
  clear_custodian: ({asset_id}: {asset_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
      new ContractSpec([ "AAAAAAAAABpHZXQgdGhlIG93bmVyIG9mIGFuIGFzc2V0LgAAAAAACG93bmVyX29mAAAAAQAAAAAAAAAIYXNzZXRfaWQAAAPuAAAAIAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAERSZWdpc3RlciBhbiBhc3NldCB0aXRsZSB1bmRlciBhbiBvd25lci4gRmFpbHMgaWYgYWxyZWFkeSByZWdpc3RlcmVkLgAAAAhyZWdpc3RlcgAAAAIAAAAAAAAACGFzc2V0X2lkAAAD7gAAACAAAAAAAAAABW93bmVyAAAAAAAAEwAAAAA=",
        "AAAAAAAAAGFUcmFuc2ZlciBhbiBhc3NldCB0aXRsZS4gUmVxdWlyZXMgYXV0aCBmcm9tIG93bmVyIChpZiBub3QgaW4gZXNjcm93KSBvciBjdXN0b2RpYW4gKGlmIGluIGVzY3JvdykuAAAAAAAACHRyYW5zZmVyAAAAAwAAAAAAAAAIYXNzZXRfaWQAAAPuAAAAIAAAAAAAAAAEZnJvbQAAABMAAAAAAAAAAnRvAAAAAAATAAAAAA==",
        "AAAAAAAAACBHZXQgdGhlIGZ1bGwgZW50cnkgZm9yIGFuIGFzc2V0LgAAAAlnZXRfZW50cnkAAAAAAAABAAAAAAAAAAhhc3NldF9pZAAAA+4AAAAgAAAAAQAAA+gAAAfQAAAAClRpdGxlRW50cnkAAA==",
        "AAAAAAAAAC5Jbml0aWFsaXplIHRoZSBjb250cmFjdCB3aXRoIGFuIGFkbWluIGFkZHJlc3MuAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAA==",
        "AAAAAAAAAKFTZXQgYW4gZXNjcm93IGN1c3RvZGlhbiBmb3IgYW4gYXNzZXQuCldoZW4gbm8gY3VzdG9kaWFuIGlzIHNldCwgb25seSB0aGUgb3duZXIgY2FuIGNhbGwgdGhpcy4KV2hlbiBhIGN1c3RvZGlhbiBpcyBhbHJlYWR5IHNldCwgb25seSB0aGF0IGN1c3RvZGlhbiBjYW4gY2hhbmdlIGl0LgAAAAAAAA1zZXRfY3VzdG9kaWFuAAAAAAAAAgAAAAAAAAAIYXNzZXRfaWQAAAPuAAAAIAAAAAAAAAAJY3VzdG9kaWFuAAAAAAAAEwAAAAA=",
        "AAAAAAAAAJZDbGVhciB0aGUgZXNjcm93IGN1c3RvZGlhbiBmb3IgYW4gYXNzZXQuCldoZW4gYSBjdXN0b2RpYW4gaXMgc2V0IChlc2Nyb3cgYWN0aXZlKSwgb25seSB0aGUgY3VzdG9kaWFuIGNhbiBjbGVhciBpdC4KT3RoZXJ3aXNlLCB0aGUgb3duZXIgY2FuIGNhbGwgdGhpcy4AAAAAAA9jbGVhcl9jdXN0b2RpYW4AAAAAAQAAAAAAAAAIYXNzZXRfaWQAAAPuAAAAIAAAAAA=",
        "AAAAAQAAAAAAAAAAAAAAClRpdGxlRW50cnkAAAAAAAMAAAAAAAAACGFzc2V0X2lkAAAD7gAAACAAAAAAAAAACWN1c3RvZGlhbgAAAAAAA+gAAAATAAAAAAAAAAVvd25lcgAAAAAAABM=",
        "AAAAAQAAAAAAAAAAAAAAC0Fzc2V0UmVjb3JkAAAAAAIAAAAAAAAACGFzc2V0X2lkAAAD7gAAACAAAAAAAAAABGhhc2gAAAPuAAAAIA==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABQAAAAAAAAAITm90Rm91bmQAAAABAAAAAAAAAAxVbmF1dGhvcml6ZWQAAAACAAAAAAAAABFBbHJlYWR5UmVnaXN0ZXJlZAAAAAAAAAMAAAAAAAAACE5vdE93bmVyAAAABAAAAAAAAAAMSW52YWxpZFN0YXRlAAAABQ==" ]),
      options
    )
  }
  public readonly fromJSON = {
    owner_of: this.txFromJSON<Option<string>>,
        register: this.txFromJSON<null>,
        transfer: this.txFromJSON<null>,
        get_entry: this.txFromJSON<Option<TitleEntry>>,
        initialize: this.txFromJSON<null>,
        set_custodian: this.txFromJSON<null>,
        clear_custodian: this.txFromJSON<null>
  }
}