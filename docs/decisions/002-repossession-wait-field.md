# ADR-002: Repossession Wait Field Added to Lease Terms

## Status

Accepted (sprint default)

## Context

The `repossess` function needs a minimum default period before a lessor can repossess an asset. This period needs to be stored per-lease rather than being a global constant.

## Options Considered

1. Add `repossession_wait: u64` field to the `Lease` struct.
2. Use a global instance-level config for minimum default period.
3. Hardcode the value in the `repossess` function.

## Decision

Option 1: Add `repossession_wait: u64` field to the `Lease` struct, defaulting to 7 days (604800 seconds).

## Consequences

- The `Lease` struct has an additional field not in README 7.2. This is an additive change per ADR-002.
- `repossess` checks that `now - start_ts >= repossession_wait` before allowing repossession.
- Default value of 7 days provides a reasonable minimum default period.

## README Sections Affected

- Section 6 (State Machine - `Defaulted --> Repossessed`)
- Section 7.2 (Data types - `Lease` struct)
- Section 7.3 (Functions - `repossess`)

## Date

2025-01-01