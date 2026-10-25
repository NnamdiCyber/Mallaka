# ADR-006: Installment Count Uses Ceil with Remainder Absorbed in Final Installment

## Status

Accepted (sprint default)

## Context

README 8.1 defines covered installments as `floor(paid / installment)`. The question is how to compute the total number of installments when `(total_price - deposit)` is not an exact multiple of `installment`.

## Options Considered

1. `total_installments = ceil((total_price - deposit) / installment)`, remainder absorbed in final installment.
2. `total_installments = floor((total_price - deposit) / installment)`, remainder left uncollected.
3. Require exact divisibility; reject leases where remainder != 0.

## Decision

Option 1: Ceil division with remainder absorbed in the final installment.

## Consequences

- Final installment may be smaller than the regular installment amount.
- `next_due` advances correctly based on covered installments.
- Completion occurs when `paid >= total_price - deposit`, regardless of installment count.

## README Sections Affected

- Section 8.1 (How the schedule works)
- Section 8.3 Rule 5 (Rounding is explicit)

## Date

2025-01-01