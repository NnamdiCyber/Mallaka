# Payment Rules

This document provides initial clarifications for README section 8 (Payment Rules). It links to the README rather than duplicating it.

## Source of Truth

See [README section 8](README.md#8-payment-rules) for the complete payment rules.

## Rules Summary

| # | Rule | Description |
|---|------|-------------|
| 1 | Partial payments accumulate | Partial payments accumulate but do not count as on time until they add up to a full installment. |
| 2 | Prepayments credit forward | Paying two installments in one day advances `next_due` by two intervals. |
| 3 | Catch-up payments cure | Any payment that clears arrears returns the lease to Active (or Grace, then Active) and emits `cured`. |
| 4 | No overpayment past the price | A payment is capped at the remaining balance. Excess is rejected, not silently kept. |
| 5 | Rounding is explicit | All amounts are integers in token base units. The final installment absorbs any remainder. |
| 6 | Time source is ledger close time | Not a client-supplied value. |

## Clarifications Captured in ADRs

| Clarification | ADR |
|--------------|-----|
| Installment count uses ceil with remainder in final installment | ADR-006 |

## Late Fees

**Off by default in the MVP.** See README 8.4.

See [README section 8](README.md#8-payment-rules) for the complete payment rules specification.