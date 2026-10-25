# ADR-005: Status Is Stored, Getters Expose Derived Status

## Status

Accepted (sprint default)

## Context

The `Lease` struct stores a `status` field. However, status can also be derived from `now`, `start_ts`, `paid`, and terms. The question is: which is authoritative?

## Options Considered

1. Stored status is authoritative; derived status is informational only.
2. Derived status is authoritative; stored status is a cache.
3. Both are stored; getters expose both stored and derived status.

## Decision

Option 3: Status is stored on the `Lease` struct. `get_status` returns a `LeaseView` containing both `stored_status` and `derived_status`.

## Consequences

- State-changing calls write the derived status to storage.
- `get_status` exposes both views for transparency and debugging.
- `check_default` updates stored status based on derived status at ledger time.

## README Sections Affected

- Section 6 (State Machine)
- Section 7.2 (Data types - `Lease.status`)
- Section 7.3 (Functions - `get_status`)

## Date

2025-01-01