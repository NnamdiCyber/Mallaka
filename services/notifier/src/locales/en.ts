import type { LocaleTable } from "../types.js";

/**
 * English templates (complete). Rules:
 *  - Plain words, short enough for one or two SMS segments.
 *  - No names, phone numbers, ID numbers or addresses. Only amounts and dates.
 *  - {placeholders} are filled by render(); every placeholder listed in TEMPLATE_PARAMS is required.
 */
export const en: LocaleTable = {
  payment_received:
    "Mallaka: we received your payment of N{amount}. Balance remaining: N{balance}. Thank you.",
  due_soon: "Mallaka: your next payment of N{amount} is due on {dueDate}.",
  grace_entered:
    "Mallaka: your payment of N{amount} was due on {dueDate}. You have until {graceEnds} to pay. Pay in the app or ask your lessor for help.",
  pre_lock:
    "Mallaka: your payment is overdue. Your vehicle may be locked after {lockAfter}, only when it is safely stopped. Pay N{amount} now to avoid this.",
  lock_engaged:
    "Mallaka: your vehicle is locked because of an overdue payment. Pay N{amount} and it unlocks right away.",
  unlock_confirmed: "Mallaka: your vehicle is unlocked. Thank you for paying.",
  lease_completed:
    "Mallaka: congratulations! You have finished paying. The vehicle is now yours.",
  otp: "Mallaka: your code is {code}. It expires in 10 minutes. Do not share it.",
};
