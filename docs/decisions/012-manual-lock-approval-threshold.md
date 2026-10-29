# ADR-012: Two-person approval threshold for manual locks

## Status

Accepted (sprint default)

## Context

README 19 ("Lock misuse") requires two-person approval for manual locks "above a threshold" but does not say what the threshold measures or how it is configured.

## Options Considered

1. Threshold on the lease's remaining balance (token base units).
2. Threshold on arrears, or on the number of locks per day.

## Decision

Option 1, the simplest: the remaining balance read from the chain. Configured by `MANUAL_LOCK_APPROVAL_THRESHOLD` (integer, token base units). When unset the value is `0`, so every manual lock needs a second approver (the safe default). Unlock never needs approval because it releases a rider.

Flow: staff request a lock, the API records a `lock_approvals` row (`pending`) and an `audit_log` entry. A different staff or admin user approves; only then is the `lock_commands` row written. The requester can never approve their own request.

The variable is added to README 16 as an additive, marked row.

## Consequences

- Minimal approval record, no additional roles.

## README Sections Affected

- Sections 16 (additive row), 19

## Date

2026-10-29
