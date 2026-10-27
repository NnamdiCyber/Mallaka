# Threat Model

This document maps system threats identified in [README Section 19 (Security Considerations)](../README.md#19-security-considerations) to mitigations, automated tests, and implementation safeguards.

| Asset | Threat | Mitigation | Status / Verification |
|---|---|---|---|
| **Contract correctness** | Arithmetic bugs, integer overflow, state machine violations | Checked arithmetic, explicit state enum, exhaustive unit and property-based test suite | **Mitigated by tests**: [`test_arithmetic_overflow_protection`](file:///home/escelit/Desktop/NnamdiCyber/Mallaka/contracts/lease/src/test.rs), [`test_installments_remaining_balance_overflow_safe`](file:///home/escelit/Desktop/NnamdiCyber/Mallaka/contracts/lease/src/test.rs), [`test_arithmetic_edge_cases_and_final_remainder`](file:///home/escelit/Desktop/NnamdiCyber/Mallaka/contracts/lease/src/test.rs), [`prop_paid_never_exceeds_total_due`](file:///home/escelit/Desktop/NnamdiCyber/Mallaka/contracts/lease/src/test.rs), [`prop_status_transitions_valid_edges`](file:///home/escelit/Desktop/NnamdiCyber/Mallaka/contracts/lease/src/test.rs), [`test_full_lifecycle_multi_day_scenario_events_in_order`](file:///home/escelit/Desktop/NnamdiCyber/Mallaka/contracts/lease/src/test.rs) |
| **Authorization** | Unauthorized state changes or asset theft | `require_auth` on state changes. Only `check_default` and `extend_ttl` are permissionless. Escrow custodian checks. | **Mitigated by tests**: [`test_unauthorized_repossess_cancel_activate`](file:///home/escelit/Desktop/NnamdiCyber/Mallaka/contracts/lease/src/test.rs), [`test_check_default_idempotent_and_arbitrary_caller`](file:///home/escelit/Desktop/NnamdiCyber/Mallaka/contracts/lease/src/test.rs), [`test_repossess_rejected_when_not_defaulted`](file:///home/escelit/Desktop/NnamdiCyber/Mallaka/contracts/lease/src/test.rs), [`test_cancel_rejected_after_activation`](file:///home/escelit/Desktop/NnamdiCyber/Mallaka/contracts/lease/src/test.rs), [`test_third_party_payer`](file:///home/escelit/Desktop/NnamdiCyber/Mallaka/contracts/lease/src/test.rs) |
| **Storage Expiration (TTL)** | Persistent contract entry eviction mid-lease | Persistent storage bumped on all state changes; keeper calls `extend_ttl` | **Mitigated by tests**: [`test_extend_ttl_keeps_entry_alive`](file:///home/escelit/Desktop/NnamdiCyber/Mallaka/contracts/lease/src/test.rs) |
| **Key management** | Sponsor/keeper/custodial key compromise | Keys held in KMS/Vault with least privilege. Separate keys per role. Rotation procedure documented. Dev signer strictly forbidden on mainnet. | Planned (enforced by `Signer` interface and `DevSigner` network check) |
| **Admin and upgrade risk** | Admin key compromise, malicious upgrades | Admin actions behind multisig. Prefer immutable or time-locked upgrade path. | Planned |
| **Webhook security** | Spoofed webhooks, replay attacks | Signature verification, replay protection, idempotency keys | Planned (enforced by `payments` provider reference uniqueness) |
| **Double-credit** | Payment credited twice | A payment is credited once. Unique constraint on `provider_reference`. Daily reconciliation between provider records and on-chain `payment` events. | Planned (enforced by database constraint) |
| **Lock misuse** | Unauthorized immobilization | Bridge re-reads on-chain state before every command, fails open, logs every action, requires two-person approval for manual locks | Planned (enforced by `services/lock-bridge`) |
| **Privacy** | Personal data on-chain | No personal data on-chain. PII encrypted at rest using AES-256-GCM. Access logged in append-only audit table. | Planned (enforced by `packages/shared/crypto` & DB schema) |
| **Denial of service** | API abuse | Rate limiting on the API. `check_default` is idempotent and cheap. | Planned |
| **Dependency risk** | Compromised dependencies | Pin versions, review updates, use lockfiles. | Mitigated (`pnpm-lock.yaml`, `Cargo.lock`) |
| **Event retention** | Lost events due to RPC pruning | Indexer persists raw events and cursors to Postgres before fan-out. | Planned (enforced by `services/indexer`) |

---

## Reporting Vulnerabilities

Please do not open public issues for security problems. Email security@<your-domain> with details. We will acknowledge within 72 hours.

See [README Section 19](README.md#19-security-considerations) for the complete security considerations.
