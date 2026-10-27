import { describe, it } from "node:test";
import assert from "node:assert";
import {
  Keypair,
  Transaction,
  Account,
  Networks,
  TransactionBuilder,
  rpc,
} from "@stellar/stellar-sdk";
import { DevSigner, KmsSigner } from "../src/chain/signer.js";
import { ChainClient, extractContractErrorCode } from "../src/chain/chain-client.js";
import { ContractError } from "../src/errors.js";

function createMockTx(sourcePubKey: string): Transaction {
  const account = new Account(sourcePubKey, "100");
  return new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .setTimeout(30)
    .build();
}

describe("Chain Signer abstraction", () => {
  const dummySeed = Keypair.random().secret();

  it("strictly refuses to instantiate DevSigner on mainnet", () => {
    assert.throws(
      () => new DevSigner(dummySeed, "mainnet"),
      (err: Error) => {
        assert(err.message.includes("CRITICAL SECURITY VIOLATION"));
        assert(err.message.includes("DevSigner is strictly forbidden on mainnet"));
        return true;
      }
    );
  });

  it("permits DevSigner on testnet and signs transactions properly", async () => {
    const signer = new DevSigner(dummySeed, "testnet");
    const pubKey = await signer.getPublicKey();
    assert(pubKey.startsWith("G"));

    const tx = createMockTx(pubKey);
    assert.strictEqual(tx.signatures.length, 0);
    await signer.signTransaction(tx);
    assert.strictEqual(tx.signatures.length, 1);
  });

  it("KmsSigner calls signFn with transaction hash and appends decorated signature", async () => {
    const pubKey = Keypair.random().publicKey();
    let capturedHash: Buffer | null = null;
    const mockSignFn = async (hash: Buffer) => {
      capturedHash = hash;
      return Buffer.alloc(64, 0xaa); // 64-byte mock ed25519 signature
    };

    const kmsSigner = new KmsSigner("projects/p/locations/l/keyRings/r/cryptoKeys/k", pubKey, mockSignFn);
    assert.strictEqual(await kmsSigner.getPublicKey(), pubKey);

    const tx = createMockTx(pubKey);
    assert.strictEqual(tx.signatures.length, 0);
    await kmsSigner.signTransaction(tx);
    assert.strictEqual(tx.signatures.length, 1);
    assert(capturedHash !== null);
    assert.deepStrictEqual(capturedHash, Buffer.from(tx.hash()));
  });
});

describe("extractContractErrorCode", () => {
  it("extracts codes from various Soroban error formats", () => {
    assert.strictEqual(extractContractErrorCode("Error(Contract, #1)"), 1);
    assert.strictEqual(extractContractErrorCode("HostError: Error(Contract, 7)"), 7);
    assert.strictEqual(extractContractErrorCode("Contract error: 9"), 9);
    assert.strictEqual(extractContractErrorCode("Transaction failed with code = 10"), 10);
    assert.strictEqual(extractContractErrorCode("Random unrelated network error"), null);
  });
});

describe("ChainClient discipline and resilience", () => {
  const testPubKey = Keypair.random().publicKey();

  it("enforces simulate before submit order", async () => {
    const callOrder: string[] = [];
    const client = new ChainClient({
      rpcUrl: "http://localhost:8000",
      pollIntervalMs: 10,
      pollTimeoutMs: 1000,
    });

    const tx = createMockTx(testPubKey);

    // Mock simulateTransaction
    client.server.simulateTransaction = async () => {
      callOrder.push("simulate");
      return {
        results: [{ auth: [], xdr: "" }],
        minResourceFee: "100",
        latestLedger: 12345,
      } as any;
    };

    // Mock sendTransaction
    client.server.sendTransaction = async () => {
      callOrder.push("send");
      return { status: "PENDING", hash: "dummy" } as any;
    };

    // Mock getTransaction
    client.server.getTransaction = async () => {
      callOrder.push("get");
      return {
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        latestLedger: 12346,
      } as any;
    };

    const result = await client.submitAndPoll(tx);
    assert.strictEqual(result.status, "SUCCESS");
    assert.deepStrictEqual(callOrder, ["simulate", "send", "get"]);
  });

  it("maps contract simulation error to README section 7.5 ContractError", async () => {
    const client = new ChainClient({ rpcUrl: "http://localhost:8000" });
    const tx = createMockTx(testPubKey);

    client.server.simulateTransaction = async () => {
      return {
        error: "HostError: Error(Contract, #9)",
        latestLedger: 123,
      } as any;
    };

    await assert.rejects(
      async () => {
        await client.submitAndPoll(tx);
      },
      (err: Error) => {
        assert(err instanceof ContractError);
        assert.strictEqual((err as ContractError).contractErrorCode, 9);
        assert.strictEqual((err as ContractError).contractErrorName, "Overpayment");
        return true;
      }
    );
  });

  it("retries on transient RPC submission errors with exponential backoff", async () => {
    const client = new ChainClient({
      rpcUrl: "http://localhost:8000",
      maxRetries: 2,
      initialRetryDelayMs: 10,
      pollIntervalMs: 10,
    });
    const tx = createMockTx(testPubKey);

    let sendAttempts = 0;
    client.server.simulateTransaction = async () => ({ results: [] }) as any;
    client.server.sendTransaction = async () => {
      sendAttempts++;
      if (sendAttempts < 2) {
        throw new Error("RPC network timeout");
      }
      return { status: "PENDING", hash: "dummy" } as any;
    };
    client.server.getTransaction = async () => ({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
      latestLedger: 200,
    }) as any;

    const res = await client.submitAndPoll(tx);
    assert.strictEqual(res.status, "SUCCESS");
    assert.strictEqual(sendAttempts, 2);
  });

  it("polls until status SUCCESS is returned", async () => {
    const client = new ChainClient({
      rpcUrl: "http://localhost:8000",
      pollIntervalMs: 10,
    });
    const tx = createMockTx(testPubKey);

    let pollCount = 0;
    client.server.simulateTransaction = async () => ({ results: [] }) as any;
    client.server.sendTransaction = async () => ({ status: "PENDING", hash: "dummy" }) as any;
    client.server.getTransaction = async () => {
      pollCount++;
      if (pollCount < 3) {
        return { status: rpc.Api.GetTransactionStatus.NOT_FOUND } as any;
      }
      return {
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        latestLedger: 500,
      } as any;
    };

    const res = await client.submitAndPoll(tx);
    assert.strictEqual(res.status, "SUCCESS");
    assert.strictEqual(pollCount, 3);
  });
});
