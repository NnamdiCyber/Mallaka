/**
 * Exact decimal helpers. Money is never handled as floating point.
 * Token amounts are integers in base units (README 8.3 rule 5).
 */

/** Stellar USDC (SAC) uses 7 decimals. */
export const TOKEN_DECIMALS = 7;

/** Parses a non-negative decimal string into an integer scaled by 10^decimals (extra digits truncated). */
export function toScaled(value: string | number, decimals: number): bigint {
  const str = typeof value === "number" ? value.toFixed(decimals) : value.trim();
  if (!/^\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid decimal amount: ${str}`);
  }
  const [whole, frac = ""] = str.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + fracPadded);
}

/** Formats a scaled integer back to a fixed-decimals string. */
export function fromScaled(value: bigint, decimals: number): string {
  const s = value.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  return decimals === 0 ? whole : `${whole}.${s.slice(s.length - decimals)}`;
}

export function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
