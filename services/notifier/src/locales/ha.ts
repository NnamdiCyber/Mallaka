import type { LocaleTable } from "../types.js";

/**
 * NEEDS NATIVE REVIEW: Hausa templates are placeholders only.
 *
 * Machine-translated text must NOT ship (README 9, ethics in README 20). Until a
 * native Hausa speaker writes and reviews each message, this table is empty and
 * Hausa riders receive the English text. To add a string, write it with a
 * reviewer's sign-off and flip HA_REVIEWED to true in the same pull request.
 *
 * TODO(NEEDS NATIVE REVIEW): payment_received, due_soon, grace_entered, pre_lock,
 * lock_engaged, unlock_confirmed, lease_completed, otp
 */
export const HA_REVIEWED = false;
export const ha: LocaleTable = {};
