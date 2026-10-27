import { describe, it } from "node:test";
import assert from "node:assert";
import {
  Keypair,
  Transaction,
  FeeBumpTransaction,
  Account,
  Networks,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { DevSigner, ChainClient } from "@mallaka/shared";
import { FeeBumpService } from "../src/fee-bump.js";
import { BalanceMonitor, BalanceAlertEvent } from "../src/balance-monitor.js";

function createMockInnerTx(riderPubKey: string): Transaction {
  const account = new Account(riderPubKey, "1");
  return new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .setTimeout(30)
    .build();
}

describe("FeeBumpService", () => {
  const sponsorSeed = Keypair.random().secret();
  const riderPubKey = Keypair.random().publicKey();

  it("wraps inner transaction into a fee-bump transaction and signs it", async () => {
    const sponsorSigner = new DevSigner(sponsorSeed, "testnet");
    const sponsorPubKey = await sponsorSigner.getPublicKey();

    const feeBumpService = new FeeBumpService({
      sponsorSigner,
      networkPassphrase: Networks.TESTNET,
      baseFee: 200000,
    });

    const innerTx = createMockInnerTx(riderPubKey);
    const feeBumpTx = await feeBumpService.wrapAndSign(innerTx);

    assert(feeBumpTx instanceof FeeBumpTransaction);
    assert.strictEqual(feeBumpTx.feeSource, sponsorPubKey);
    assert.strictEqual(feeBumpTx.fee, "200000");
    assert.strictEqual(feeBumpTx.signatures.length, 1);
  });
});

describe("BalanceMonitor", () => {
  const sponsorPubKey = Keypair.random().publicKey();

  it("reports healthy balance without firing alert when above threshold", async () => {
    let alertFired = false;
    const monitor = new BalanceMonitor({
      sponsorPublicKey: sponsorPubKey,
      minBalanceThreshold: 50,
      getBalanceFn: async () => 100, // 100 XLM
      onLowBalanceAlert: () => {
        alertFired = true;
      },
    });

    const res = await monitor.checkBalance();
    assert.strictEqual(res.balance, 100);
    assert.strictEqual(res.isLow, false);
    assert.strictEqual(alertFired, false);
  });

  it("emits alert event when sponsor balance falls below threshold", async () => {
    let capturedAlert: BalanceAlertEvent | null = null;
    const monitor = new BalanceMonitor({
      sponsorPublicKey: sponsorPubKey,
      minBalanceThreshold: 50,
      getBalanceFn: async () => 25.5, // 25.5 XLM < 50 XLM
      onLowBalanceAlert: (evt) => {
        capturedAlert = evt;
      },
    });

    const res = await monitor.checkBalance();
    assert.strictEqual(res.balance, 25.5);
    assert.strictEqual(res.isLow, true);
    assert(capturedAlert !== null);
    assert.strictEqual(capturedAlert.sponsorPublicKey, sponsorPubKey);
    assert.strictEqual(capturedAlert.currentBalance, 25.5);
    assert.strictEqual(capturedAlert.minBalanceThreshold, 50);
  });
});
