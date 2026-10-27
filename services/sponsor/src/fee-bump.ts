import {
  Transaction,
  FeeBumpTransaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { Signer, Logger, createLogger } from "@mallaka/shared";

export interface FeeBumpOptions {
  sponsorSigner: Signer;
  networkPassphrase: string;
  baseFee?: string | number; // in stroops, default 100000 (0.01 XLM)
  logger?: Logger;
}

export class FeeBumpService {
  private readonly sponsorSigner: Signer;
  private readonly networkPassphrase: string;
  private readonly baseFee: string;
  private readonly logger: Logger;

  constructor(options: FeeBumpOptions) {
    this.sponsorSigner = options.sponsorSigner;
    this.networkPassphrase = options.networkPassphrase;
    this.baseFee = String(options.baseFee ?? "100000");
    this.logger = options.logger ?? createLogger("sponsor:fee-bump");
  }

  /**
   * Wraps an existing user/rider transaction in a Fee-Bump transaction
   * where the sponsor account pays the network fees.
   * Riders hold no XLM.
   */
  async wrapAndSign(innerTx: Transaction): Promise<FeeBumpTransaction> {
    const sponsorPubKey = await this.sponsorSigner.getPublicKey();
    this.logger.debug("Wrapping transaction in fee-bump", {
      sponsorPubKey,
      innerTxHash: Buffer.from(innerTx.hash()).toString("hex"),
      baseFee: this.baseFee,
    });

    const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
      sponsorPubKey,
      this.baseFee,
      innerTx,
      this.networkPassphrase
    );

    // Sign the fee bump transaction with the sponsor key
    await this.sponsorSigner.signTransaction(feeBumpTx);

    this.logger.info("Fee-bump transaction signed successfully", {
      feeBumpTxHash: Buffer.from(feeBumpTx.hash()).toString("hex"),
      sponsorPubKey,
    });

    return feeBumpTx;
  }
}
