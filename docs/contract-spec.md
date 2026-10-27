# Contract Specification

This document summarizes the smart contract interfaces, data types, events, errors, storage layout, and authorization model implemented for Mallaka. It serves as the bridge between the high-level design in the [README.md](../README.md) and the Rust contract implementation in [`contracts/`](../contracts/).

## 1. Source of Truth

The canonical requirements and rules are defined in:
- [README Section 6: Lease Lifecycle and State Machine](../README.md#6-lease-lifecycle-and-state-machine)
- [README Section 7: Smart Contract Specification](../README.md#7-smart-contract-specification)
- [README Section 8: Payment Rules](../README.md#8-payment-rules)
- [README Section 17: Testing Strategy](../README.md#17-testing-strategy)

Architectural decisions governing contracts:
- [ADR-001: Cure event on cure](../docs/decisions/001-cure-event-on-cure.md)
- [ADR-002: Minimum repossession wait time](../docs/decisions/002-repossession-wait-time.md)
- [ADR-003: Direct completion from default](../docs/decisions/003-direct-completion-from-default.md)
- [ADR-004: Deposit accounting](../docs/decisions/004-deposit-accounting.md)
- [ADR-005: Stored vs derived status](../docs/decisions/005-stored-vs-derived-status.md)
- [ADR-006: Remainder absorption in final installment](../docs/decisions/006-remainder-absorption.md)
- [ADR-009: Escrow custodian transfer pattern](../docs/decisions/009-title-escrow-custodian-transfer.md)

---

## 2. Contracts Overview

| Contract | Location | Description |
|---|---|---|
| `lease` | [`contracts/lease/`](../contracts/lease/) | Core lease logic: term validation, payments, state transitions, title escrow release. |
| `title-registry` | [`contracts/title-registry/`](../contracts/title-registry/) | Minimal asset title registry that the lease contract locks in escrow as custodian and transfers on completion/repossession/cancellation. |

Payments use the standard Stellar Asset Contract (SAC) for USDC. No custom payment token is deployed.

---

## 3. Function Signatures and Interface

See [README Section 7.3](../README.md#73-functions).

### `lease` Contract

```rust
pub trait LeaseContractTrait {
    fn initialize(e: Env, admin: Address) -> Result<(), Error>;
    fn create_lease(e: Env, lessor: Address, lessee: Address, asset_id: BytesN<32>, title_contract: Address, token: Address, terms: Terms) -> Result<u64, Error>;
    fn activate(e: Env, lease_id: u64) -> Result<(), Error>;
    fn pay(e: Env, lease_id: u64, payer: Address, amount: i128) -> Result<(), Error>;
    fn check_default(e: Env, lease_id: u64) -> Result<Status, Error>;
    fn repossess(e: Env, lease_id: u64) -> Result<(), Error>;
    fn cancel(e: Env, lease_id: u64) -> Result<(), Error>;
    fn get_lease(e: Env, lease_id: u64) -> Result<Lease, Error>;
    fn get_status(e: Env, lease_id: u64) -> Result<LeaseView, Error>;
    fn extend_ttl(e: Env, lease_id: u64) -> Result<(), Error>;
}
```

### `title-registry` Contract

```rust
pub trait TitleRegistryTrait {
    fn initialize(e: Env, admin: Address) -> Result<(), Error>;
    fn register(e: Env, owner: Address, asset_id: BytesN<32>) -> Result<(), Error>;
    fn set_custodian(e: Env, caller: Address, asset_id: BytesN<32>, custodian: Address) -> Result<(), Error>;
    fn clear_custodian(e: Env, caller: Address, asset_id: BytesN<32>) -> Result<(), Error>;
    fn transfer(e: Env, caller: Address, asset_id: BytesN<32>, new_owner: Address) -> Result<(), Error>;
    fn owner_of(e: Env, asset_id: BytesN<32>) -> Result<Option<Address>, Error>;
    fn get_entry(e: Env, asset_id: BytesN<32>) -> Result<Option<TitleEntry>, Error>;
}
```

---

## 4. Events

See [README Section 7.4](../README.md#74-events).

| Event | Topics | Data | Target Services |
|---|---|---|---|
| `lease_created` | `("lease_created", lease_id, lessor, lessee)` | `asset_id` (Terms hash/ID) | Indexer |
| `activated` | `("activated", lease_id)` | `(start_ts, deposit)` | Indexer, Lock Bridge |
| `payment` | `("payment", lease_id, payer)` | `(amount, paid_total, next_due)` | Indexer, Notifications |
| `grace_entered` | `("grace_entered", lease_id)` | `(due_ts, grace_ends)` | Notifications |
| `defaulted` | `("defaulted", lease_id)` | `arrears` | **Lock Bridge (immobilize)** |
| `cured` | `("cured", lease_id)` | `paid_total` | **Lock Bridge (unlock)** |
| `completed` | `("completed", lease_id, lessee)` | `final_paid` | **Lock Bridge (permanent unlock)**, Indexer |
| `repossessed` | `("repossessed", lease_id)` | `repossess_ts` | Lock Bridge, Indexer |
| `cancelled` | `("cancelled", lease_id)` | `cancel_ts` | Indexer |

---

## 5. Errors

See [README Section 7.5](../README.md#75-errors).

| Error Name | Code | Trigger Condition |
|---|---|---|
| `NotFound` | `1` | Lease ID or asset not found in storage. |
| `Unauthorized` | `2` | Caller failed authentication or custodian authorization. |
| `InvalidTerms` | `3` | Terms validation failed (zero total_price, deposit >= total_price, zero interval). |
| `InvalidState` | `4` | Action cannot be taken from current lease status (e.g., cancel when not Pending). |
| `InvalidAmount` | `5` | Non-positive payment or deposit amount. |
| `AlreadyActive` | `6` | Attempted activation on an already activated lease. |
| `NotDefaulted` | `7` | `repossess` attempted when lease status is not `Defaulted`. |
| `RepossessionTooEarly` | `8` | `repossess` attempted before `repossession_wait` elapsed past default. |
| `Overpayment` | `9` | Payment exceeds remaining balance to complete lease (`paid + amount > total_price - deposit`). |
| `MathOverflow` | `10` | Checked arithmetic overflow detected on amount or timestamp calculation. |

---

## 6. Storage and TTL Management

See [README Section 7.6](../README.md#76-storage-and-ttl).

- **Instance Storage**:
  - `admin`: Protocol administrator address.
  - `next_id`: Monotonically incrementing u64 lease identifier.
- **Persistent Storage**:
  - `Lease(u64)`: The complete `Lease` struct keyed by `DataKey::Lease(id)`.
  - Every state-changing invocation (`create_lease`, `activate`, `pay`, `check_default`, `repossess`, `cancel`) extends the entry TTL:
    - Threshold: 5,000 ledgers (~7 hours).
    - Extension: 120,960 ledgers (~7 days).
  - `extend_ttl(lease_id)`: Bumps TTL on persistent lease entry without requiring authentication or state mutation.

---

## 7. Authorization Model

See [README Section 7.7](../README.md#77-authorization-model).

| Function | Required Auth | Notes |
|---|---|---|
| `create_lease` | `lessor.require_auth()` | Lessor commits terms and assets. |
| `activate` | `lessee.require_auth()` | Lessee confirms agreement and pays deposit. |
| `pay` | `payer.require_auth()` | Allows lessee OR third-party sponsor to pay. |
| `repossess` | `lessor.require_auth()` | Only lessor can reclaim physical asset. |
| `cancel` | `lessor.require_auth()` | Only lessor can cancel unactivated lease. |
| `check_default` | **None** | Permissionless; idempotent evaluation of ledger close time. |
| `extend_ttl` | **None** | Permissionless; keeps active entries alive. |
| `get_lease` / `get_status` | **None** | Read-only queries. |
