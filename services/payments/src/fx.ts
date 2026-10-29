/**
 * FX rate provider (README 12). Pluggable so a real rate source can replace the
 * fixed dev rate. The rate and its source are recorded on EVERY payment.
 *
 * TODO(README 22 item 7): who bears FX risk, and how prices are set, is an open
 * design question. Nothing here decides it. We only record the rate used.
 */
export interface FxQuote {
  /** Naira per 1 unit of the settlement token (USD-pegged), as a decimal string. */
  nairaPerToken: string;
  /** Human-readable source, stored in payments.fx_rate_source. */
  source: string;
}

export interface FxRateProvider {
  getQuote(): Promise<FxQuote>;
}

/** Development implementation: a constant rate. NOT for production use. */
export class FixedRateProvider implements FxRateProvider {
  constructor(private readonly nairaPerToken = "1500.000000") {}

  async getQuote(): Promise<FxQuote> {
    return { nairaPerToken: this.nairaPerToken, source: `fixed-dev:${this.nairaPerToken}` };
  }
}
