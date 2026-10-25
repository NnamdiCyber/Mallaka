# ADR-001: Cured Event Semantics

## Status

Accepted (sprint default)

## Context

When a lease in `Grace` or `Defaulted` receives a payment that clears arrears, it transitions back to `Active`. The question is: should the `cured` event be emitted only for `Grace->Active` or also for `Defaulted->Active`?

## Options Considered

1. Emit `cured` only on `Grace->Active` transitions.
2. Emit `cured` on both `Grace->Active` and `Defaulted->Active` transitions.

## Decision

Option 2: Emit `cured` on both `Grace->Active` and `Defaulted->Active` transitions.

## Consequences

- The lock bridge receives `cured` events for both grace and default cures, triggering unlock commands in both cases.
- Consistent with README 6 state machine: `Grace --> Active: pay (arrears cleared)` and `Defaulted --> Active: pay (arrears cleared, cure)`.
- The `cured` event data includes `paid_total` for indexer consumption.

## README Sections Affected

- Section 6 (Lease Lifecycle and State Machine)
- Section 7.4 (Events - `cured`)
- Section 8.3 Rule 3 (Catch-up payments cure arrears)

## Date

2025-01-01