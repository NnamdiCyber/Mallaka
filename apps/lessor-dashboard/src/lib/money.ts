/** Amounts arrive as decimal strings. Sum them as integer hundredths so no floating point error creeps in. */
export function toCents(value: string): bigint {
  const [w, f = ""] = value.split(".");
  return BigInt(w || "0") * 100n + BigInt((f + "00").slice(0, 2));
}

export function fromCents(cents: bigint): string {
  const s = cents.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

export const sumMoney = (values: string[]): string => fromCents(values.reduce((a, v) => a + toCents(v), 0n));

export function naira(value: string): string {
  const [whole, frac = "00"] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₦${grouped}${/^0*$/.test(frac) ? "" : `.${frac.padEnd(2, "0").slice(0, 2)}`}`;
}

export function usd(value: string): string {
  const [whole, frac = "00"] = value.split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac.padEnd(2, "0").slice(0, 2)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dateText(value: number | string): string {
  const d = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function dateTimeText(value: string): string {
  const d = new Date(value);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dateText(value)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}
