import {
  Keypair,
  Transaction,
  FeeBumpTransaction,
  xdr,
} from "@stellar/stellar-sdk";

export interface Signer {
  getPublicKey(): Promise<string>;
  signTransaction<T extends Transaction | FeeBumpTransaction>(tx: T): Promise<T>;
}

/**
 * Local development signer using an in-memory secret key.
 * STRICT SECURITY INVARIANT: Only permitted when STELLAR_NETWORK is 'testnet'.
 * Refuses to instantiate if network is 'mainnet'.
 */
export class DevSigner implements Signer {
  private readonly keypair: Keypair;

  constructor(secretSeed: string, network: "testnet" | "mainnet" | string) {
    if (network === "mainnet") {
      throw new Error(
        "CRITICAL SECURITY VIOLATION: DevSigner is strictly forbidden on mainnet! Production keys must use KMS/Vault."
      );
    }
    if (!secretSeed || !secretSeed.startsWith("S")) {
      throw new Error("Invalid secret seed provided to DevSigner");
    }
    this.keypair = Keypair.fromSecret(secretSeed);
  }

  async getPublicKey(): Promise<string> {
    return this.keypair.publicKey();
  }

  async signTransaction<T extends Transaction | FeeBumpTransaction>(tx: T): Promise<T> {
    tx.sign(this.keypair);
    return tx;
  }
}

export type KmsSignFunction = (hash: Buffer) => Promise<Buffer>;

/**
 * Cloud KMS / Vault backed signer.
 * Holds no local private keys. Private keys remain secure inside the HSM/KMS.
 */
export class KmsSigner implements Signer {
  constructor(
    public readonly keyId: string,
    private readonly publicKey: string,
    private readonly signFn: KmsSignFunction
  ) {
    if (!keyId) {
      throw new Error("KmsSigner requires a valid keyId");
    }
    if (!publicKey || !publicKey.startsWith("G")) {
      throw new Error("KmsSigner requires a valid Stellar public key (G...)");
    }
  }

  async getPublicKey(): Promise<string> {
    return this.publicKey;
  }

  async signTransaction<T extends Transaction | FeeBumpTransaction>(tx: T): Promise<T> {
    const txHash = Buffer.from(tx.hash());
    const signatureBytes = await this.signFn(txHash);

    const hint = Buffer.from(this.publicKey, "utf8").subarray(-4);
    const decoratedSig = new xdr.DecoratedSignature({
      hint,
      signature: signatureBytes,
    });

    tx.signatures.push(decoratedSig);
    return tx;
  }
}
