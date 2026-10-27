# ADR-009: Escrow Custodian Transfer and Release in Title Registry

## Status

Accepted (sprint default)

## Context

README 7.1 and 7.3 specify that the lease contract holds the asset title in escrow, transfers the title to the lessee on completion, and releases the title back to the lessor on cancellation or repossession. In Soroban, when `pay` completes a lease or when `repossess`/`cancel` is called, title-registry must allow the designated custodian contract to clear custodian status or execute the ownership transfer to the lessee without requiring a separate signature from the lessor at that moment.

## Options Considered

1. Update `clear_custodian` and `transfer` in `title-registry` to recognize the registered custodian contract as authorized to clear custodian (releasing title back to the lessor) or transfer the title to the lessee upon lease completion.
2. Require lessor auth on every completion transfer and repossession/cancellation, which breaks automated completion and permissionless processing.

## Decision

Option 1: In `title-registry`, `clear_custodian` and `transfer` allow execution by the registered custodian contract. When the lease contract is the custodian, it can clear custodian status (releasing title back to the lessor) on `repossess` and `cancel`, and transfer title to `lessee` on completion.

## Consequences

- The lease contract can automatically transfer title to the lessee when `paid >= total_price - deposit`.
- On `repossess` and `cancel`, title escrow is released back to the lessor without custodian lock.
- Function signatures, events, and error types remain unchanged.

## README Sections Affected

- Section 6 (State Machine - Title column)
- Section 7.1 (Contracts - title-registry)
- Section 7.3 (Functions - create_lease, pay, repossess, cancel)

## Date

2026-10-27
