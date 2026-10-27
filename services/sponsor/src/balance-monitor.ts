import { Logger, createLogger } from "@mallaka/shared";

export interface BalanceAlertEvent {
  sponsorPublicKey: string;
  currentBalance: number;
  minBalanceThreshold: number;
  timestamp: string;
}

export type AlertCallback = (event: BalanceAlertEvent) => void;

export interface BalanceMonitorOptions {
  sponsorPublicKey: string;
  minBalanceThreshold: number; // e.g. from SPONSOR_MIN_BALANCE
  getBalanceFn: (address: string) => Promise<number>;
  onLowBalanceAlert?: AlertCallback;
  logger?: Logger;
}

export class BalanceMonitor {
  private readonly sponsorPublicKey: string;
  private readonly minBalanceThreshold: number;
  private readonly getBalanceFn: (address: string) => Promise<number>;
  private readonly onLowBalanceAlert?: AlertCallback;
  private readonly logger: Logger;

  constructor(options: BalanceMonitorOptions) {
    this.sponsorPublicKey = options.sponsorPublicKey;
    this.minBalanceThreshold = options.minBalanceThreshold;
    this.getBalanceFn = options.getBalanceFn;
    this.onLowBalanceAlert = options.onLowBalanceAlert;
    this.logger = options.logger ?? createLogger("sponsor:balance-monitor");
  }

  /**
   * Queries current balance, records metric, and emits an alert if below threshold.
   */
  async checkBalance(): Promise<{ balance: number; isLow: boolean }> {
    const balance = await this.getBalanceFn(this.sponsorPublicKey);

    this.logger.debug("Sponsor account balance check", {
      sponsorPublicKey: this.sponsorPublicKey,
      balanceXlm: balance,
      thresholdXlm: this.minBalanceThreshold,
    });

    const isLow = balance < this.minBalanceThreshold;
    if (isLow) {
      const alertEvent: BalanceAlertEvent = {
        sponsorPublicKey: this.sponsorPublicKey,
        currentBalance: balance,
        minBalanceThreshold: this.minBalanceThreshold,
        timestamp: new Date().toISOString(),
      };

      this.logger.error("CRITICAL: Sponsor XLM balance is below threshold!", {
        ...alertEvent,
        metric: "sponsor_balance_low",
      });

      this.onLowBalanceAlert?.(alertEvent);
    }

    return { balance, isLow };
  }
}
