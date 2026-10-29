/** "₦15,000" (drops ".00"). Input is a decimal string from the API. */
export function naira(value: string): string {
  const [whole, frac = "00"] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₦${grouped}${/^0*$/.test(frac) ? "" : `.${frac.padEnd(2, "0").slice(0, 2)}`}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "30 Oct 2026" in UTC, so the same date shows for everyone. Accepts unix seconds or an ISO string. */
export function dateText(value: number | string): string {
  const d = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "30 Oct 2026, 14:05" (UTC) for the "last updated" label. */
export function dateTimeText(value: number | string | Date): string {
  const d = value instanceof Date ? value : typeof value === "number" ? new Date(value * 1000) : new Date(value);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dateText(d.toISOString())}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function intervalWord(seconds: number): "day" | "week" | "period" {
  return seconds === 86_400 ? "day" : seconds === 604_800 ? "week" : "period";
}

export function days(seconds: number): number {
  return Math.round(seconds / 86_400);
}
