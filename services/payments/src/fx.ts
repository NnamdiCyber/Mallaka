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

export interface OracleOptions {
  oracleUrl: string;
  fetchFn?: typeof fetch;
  cacheTtlMs?: number;
  minRate?: number;
  maxRate?: number;
  fallbackProvider?: FxRateProvider;
  now?: () => Date;
}

/** Production Oracle FX Rate Provider with caching, bounds checking, and fallback resilience. */
export class OracleFxRateProvider implements FxRateProvider {
  private cachedQuote?: FxQuote;
  private cachedAtMs = 0;
  private readonly fetchFn: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly minRate: number;
  private readonly maxRate: number;
  private readonly now: () => Date;

  constructor(private readonly opts: OracleOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.cacheTtlMs = opts.cacheTtlMs ?? 5 * 60 * 1000;
    this.minRate = opts.minRate ?? 100;
    this.maxRate = opts.maxRate ?? 50000;
    this.now = opts.now ?? (() => new Date());
  }

  async getQuote(): Promise<FxQuote> {
    const nowMs = this.now().getTime();
    if (this.cachedQuote && nowMs - this.cachedAtMs < this.cacheTtlMs) {
      return this.cachedQuote;
    }

    try {
      const res = await this.fetchFn(this.opts.oracleUrl);
      if (!res.ok) throw new Error(`Oracle request failed with HTTP ${res.status}`);
      const data = (await res.json()) as { rate?: number | string; nairaPerToken?: number | string };
      const rawRate = Number(data.rate ?? data.nairaPerToken);
      if (!Number.isFinite(rawRate) || rawRate < this.minRate || rawRate > this.maxRate) {
        throw new Error(`Oracle rate out of acceptable bounds: ${rawRate}`);
      }
      let hostname = "oracle";
      try {
        hostname = new URL(this.opts.oracleUrl).hostname;
      } catch {
        // use fallback hostname
      }
      const quote: FxQuote = {
        nairaPerToken: rawRate.toFixed(6),
        source: `oracle:${hostname}`,
      };
      this.cachedQuote = quote;
      this.cachedAtMs = nowMs;
      return quote;
    } catch (err) {
      if (this.cachedQuote) {
        return {
          nairaPerToken: this.cachedQuote.nairaPerToken,
          source: `${this.cachedQuote.source}:stale-fallback`,
        };
      }
      if (this.opts.fallbackProvider) {
        return this.opts.fallbackProvider.getQuote();
      }
      throw err;
    }
  }
}
