# ADR-003: Defaulted->Completed Payments Allowed

## Status

Accepted (sprint default)

## Context

README 8.2 states that `paid >= total_price - deposit` implies `Completed`. The state machine in README 6 shows `Defaulted --> Completed: pay (paid >= total price)`. The question is whether a payment made while `Defaulted` that completes the lease should emit `payment` followed by `completed`.

## Options Considered

1. Allow payments from `Defaulted` and emit both `payment` and `completed` events.
2. Block payments from `Defaulted` entirely; require `check_default` + `pay` from `Grace` only.
3. Allow payments from `Defaulted` but only emit `completed`, not `payment`.

## Decision

Option 1: Allow payments from `Defaulted`, emit `payment` then `completed` when `paid >= total_price - deposit`.

## Consequences

- `pay` is valid from `Active`, `Grace`, and `Defaulted` states.
- When a Defaulted lease is completed, title transfers to the lessee and the lease becomes `Completed`.
- Consistent with README 6 state machine transition `Defaulted --> Completed`.

## README Sections Affected

- Section 6 (State Machine)
- Section 7.3 (Functions - `pay`)
- Section 8.2 (Status derivation - Completed row)

## Date

2025-01-01