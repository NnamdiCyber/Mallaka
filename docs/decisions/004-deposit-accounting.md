# ADR-004: Deposit Accounting Follows README Exactly

## Status

Accepted (sprint default)

## Context

README 7.2 defines `deposit: i128` as a field on `Lease`. README 8.1 defines remaining balance as `total_price - deposit`. The question is how the deposit is accounted for: is it part of `paid`, tracked separately, or excluded from `paid`?

## Options Considered

1. `paid` excludes deposit (deposit tracked separately but not added to `paid`).
2. `paid` includes deposit.
3. Deposit is not stored on the lease at all.

## Decision

Option 1: `paid` excludes deposit. `paid` starts at 0 after `activate` and only accumulates installment payments. Remaining balance = `total_price - deposit - paid`.

## Consequences

- `paid` field semantics match README 7.2 ("cumulative paid, excluding deposit").
- Completion threshold is `paid >= total_price - deposit`.
- Deposit is transferred directly from lessee to lessor during `activate` and is never held by the contract.

## README Sections Affected

- Section 7.2 (Data types - `Lease.paid`)
- Section 8.1 (How the schedule works)

## Date

2025-01-01