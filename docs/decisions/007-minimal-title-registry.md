# ADR-007: Minimal Title Registry

## Status

Accepted (sprint default)

## Context

README 7.1 describes the title registry as a "Minimal asset title registry (or NFT interface)". The question is whether to implement a full NFT standard or a minimal registry.

## Options Considered

1. Full NFT implementation (SEP-21, metadata, marketplaces).
2. Minimal registry with `register`, `owner_of`, `transfer`, `set_custodian`, `clear_custodian`.
3. No registry; title tracked only on the lease contract.

## Decision

Option 2: Minimal registry keyed by `asset_id` (BytesN<32>, hash of off-chain asset record).

## Consequences

- No NFT standards, metadata, or marketplace functionality.
- `asset_id` is an opaque hash (no personal data on-chain).
- Supports escrow via custodian mechanism for lease title holding.
- Events emitted for `register` and `transfer`.

## README Sections Affected

- Section 5 (Responsibility split - Title ownership)
- Section 6 (State Machine - Title column)
- Section 7.1 (Contracts - title-registry)

## Date

2025-01-01