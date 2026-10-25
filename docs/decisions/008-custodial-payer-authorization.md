# ADR-008: Custodial Payer Authorization for MVP

## Status

Accepted (sprint default)

## Context

README 12 describes two custody models: custodial (MVP default) and passkey smart accounts. The question is how payer authorization works for `pay` in the MVP.

## Options Considered

1. Custodial: backend holds keys or acts as authorized payer; `payer.require_auth()` on `pay`.
2. Passkey smart accounts: rider signs with device biometrics.
3. Allow any address to pay without auth.

## Decision

Option 1: Custodial payer authorization for MVP. `pay` calls `payer.require_auth()` where payer may differ from lessee.

## Consequences

- `pay` accepts a separate `payer` address so backend/agents/family can pay on rider's behalf.
- Migration path to passkeys documented in README 22.
- Consistent with README 7.3 and 7.7.

## README Sections Affected

- Section 7.3 (Functions - `pay`)
- Section 7.7 (Authorization model)
- Section 12 (Payments, Wallets, and On/Off-Ramp)

## Date

2025-01-01