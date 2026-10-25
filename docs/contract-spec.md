# Contract Specification

This document provides initial clarifications for README section 7 (Smart Contract Specification). It links to the README rather than duplicating it.

## Source of Truth

See [README section 7](README.md#7-smart-contract-specification) for the complete contract specification.

## Clarifications Captured in ADRs

| Clarification | ADR |
|--------------|-----|
| `cured` emitted on Grace->Active and Defaulted->Active | ADR-001 |
| `repossession_wait` field added to Lease struct | ADR-002 |
| Defaulted->Completed payments allowed, emit payment then completed | ADR-003 |
| Deposit accounting: `paid` excludes deposit | ADR-004 |
| Status stored; getters expose both stored and derived | ADR-005 |
| Installment count uses ceil; remainder in final installment | ADR-006 |

## Contracts

| Contract | Purpose |
|----------|---------|
| `lease` | Core lease logic: terms, payments, state transitions, title release. |
| `title-registry` | Minimal asset title registry that the lease contract holds in escrow and transfers on completion. |

Payments use the **Stellar Asset Contract (SAC)** for USDC via the standard Soroban token interface. No custom token is deployed.