import {
  rpc,
  Transaction,
  FeeBumpTransaction,
} from "@stellar/stellar-sdk";
import { Logger, createLogger } from "../logger.js";
import { ContractError, AppError } from "../errors.js";

export interface ChainClientOptions {
  rpcUrl: string;
  networkPassphrase?: string;
  maxRetries?: number;
  initialRetryDelayMs?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  logger?: Logger;
}

export interface SubmitResult {
  txHash: string;
  status: "SUCCESS" | "FAILED";
  ledger?: number;
  returnValue?: unknown;
}

/**
 * Extracts a contract error code (1-10 per README 7.5) from simulation or error results.
 */
export function extractContractErrorCode(rawError: string): number | null {
  // Common Soroban contract error patterns:
  // "Error(Contract, #3)" or "Error(Contract, 3)" or "contract error: 3"
  const match = rawError.match(/Error\(Contract,\s*#?([0-9]+)\)/i) ||
                rawError.match(/contract\s*error\s*[:=]?\s*#?([0-9]+)/i) ||
                rawError.match(/code\s*[:=]\s*#?([0-9]+)/i);
  if (match) {
    const code = parseInt(match[1], 10);
    if (!isNaN(code)) {
      return code;
    }
  }
  return null;
}

/**
 * Safe Chain Client adhering to README section 9 & 12 discipline:
 * 1. ALWAYS simulate before submitting.
 * 2. Submit with bounded retries and exponential backoff.
 * 3. Poll transaction status until final, with a timeout.
 * 4. Map contract errors to README section 7.5 names.
 * 5. Never log secrets.
 */
export class ChainClient {
  public readonly server: rpc.Server;
  private readonly maxRetries: number;
  private readonly initialRetryDelayMs: number;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly logger: Logger;

  constructor(options: ChainClientOptions) {
    this.server = new rpc.Server(options.rpcUrl, { allowHttp: options.rpcUrl.startsWith("http://") });
    this.maxRetries = options.maxRetries ?? 3;
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? 500;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 30000;
    this.logger = options.logger ?? createLogger("chain-client");
  }

  /**
   * Simulates a transaction. Always called before submitting.
   */
  async simulate(tx: Transaction): Promise<rpc.Api.SimulateTransactionResponse> {
    const txHash = Buffer.from(tx.hash()).toString("hex");
    this.logger.debug("Simulating transaction on Soroban RPC", { txHash });
    const sim = await this.server.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(sim)) {
      const errorMsg = sim.error || "Simulation failed";
      const code = extractContractErrorCode(errorMsg);
      if (code !== null) {
        throw ContractError.fromCode(code);
      }
      throw new AppError(`Simulation error: ${errorMsg}`, 400, "SIMULATION_FAILED");
    }

    return sim;
  }

  /**
   * Submits a transaction with bounded exponential backoff retries,
   * then polls until final status (SUCCESS or FAILED) or timeout.
   */
  async submitAndPoll(
    tx: Transaction | FeeBumpTransaction,
    skipSimulation = false
  ): Promise<SubmitResult> {
    const txHash = Buffer.from(tx.hash()).toString("hex");

    // DISCIPLINE 1: ALWAYS simulate before submitting (unless already fee-bumped or explicitly instructed)
    if (!skipSimulation && tx instanceof Transaction) {
      await this.simulate(tx);
    }

    // DISCIPLINE 2: Submit with bounded retries and exponential backoff
    let sendResponse: rpc.Api.SendTransactionResponse | null = null;
    let attempt = 0;
    let delay = this.initialRetryDelayMs;

    while (attempt <= this.maxRetries) {
      attempt++;
      try {
        this.logger.debug("Sending transaction to RPC", { txHash, attempt });
        sendResponse = await this.server.sendTransaction(tx);

        if (sendResponse.status === "ERROR") {
          const errDetail = JSON.stringify(sendResponse.errorResult || sendResponse);
          const code = extractContractErrorCode(errDetail);
          if (code !== null) {
            throw ContractError.fromCode(code);
          }
          if (attempt > this.maxRetries) {
            throw new AppError(`Transaction submission failed: ${errDetail}`, 400, "TX_SUBMISSION_ERROR");
          }
        } else {
          // Accepted or Pending
          break;
        }
      } catch (err) {
        if (err instanceof ContractError) {
          throw err;
        }
        if (attempt > this.maxRetries) {
          throw err;
        }
        this.logger.warn("Transient error submitting transaction, retrying...", {
          txHash,
          attempt,
          delayMs: delay,
          error: (err as Error).message,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // exponential backoff
      }
    }

    // DISCIPLINE 3: Poll transaction status until final, with a timeout
    const startTime = Date.now();
    while (Date.now() - startTime < this.pollTimeoutMs) {
      this.logger.debug("Polling transaction status", { txHash });
      const statusRes = await this.server.getTransaction(txHash);

      if (statusRes.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        this.logger.info("Transaction confirmed successfully", {
          txHash,
          ledger: statusRes.latestLedger,
        });
        return {
          txHash,
          status: "SUCCESS",
          ledger: statusRes.latestLedger,
          returnValue: statusRes.returnValue,
        };
      }

      if (statusRes.status === rpc.Api.GetTransactionStatus.FAILED) {
        const errorDetail = JSON.stringify(statusRes.resultXdr || statusRes);
        const code = extractContractErrorCode(errorDetail);
        if (code !== null) {
          throw ContractError.fromCode(code);
        }
        throw new AppError(`Transaction failed on-chain: ${errorDetail}`, 400, "TX_FAILED");
      }

      // Still NOT_FOUND, wait and continue polling
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }

    throw new AppError(
      `Transaction status polling timed out after ${this.pollTimeoutMs}ms for tx ${txHash}`,
      504,
      "TX_POLL_TIMEOUT"
    );
  }
}
