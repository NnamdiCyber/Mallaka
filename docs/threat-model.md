# Threat Model

This document is a skeleton table pre-filled from README section 19 (Security Considerations). All items are marked "planned".

| Asset | Threat | Mitigation | Status |
|-------|--------|------------|--------|
| Contract correctness | Arithmetic bugs, state machine violations | Checked arithmetic, explicit state machine, exhaustive tests, external audit before mainnet | planned |
| Authorization | Unauthorized state changes | `require_auth` on every state-changing call. Only `check_default` and `extend_ttl` are permissionless. | planned |
| Key management | Sponsor/keeper/custodial key compromise | Keys held in KMS/Vault with least privilege. Separate keys per role. Rotation procedure documented. | planned |
| Admin and upgrade risk | Admin key compromise, malicious upgrades | Admin actions behind multisig. Prefer immutable or time-locked upgrade path. | planned |
| Webhook security | Spoofed webhooks, replay attacks | Signature verification, replay protection, idempotency keys | planned |
| Double-credit | Payment credited twice | A payment is credited once. Daily reconciliation between provider records and on-chain `payment` events. | planned |
| Lock misuse | Unauthorized immobilization | Bridge re-reads on-chain state before every command, fails open, logs every action, requires two-person approval for manual locks | planned |
| Privacy | Personal data on-chain | No personal data on-chain. PII encrypted at rest. Access logged. | planned |
| Denial of service | API abuse | Rate limiting on the API. `check_default` is idempotent and cheap. | planned |
| Dependency risk | Compromised dependencies | Pin versions, review updates, use lockfiles. | planned |
| Event retention | Lost events | Indexer persists events because RPC retains them only for a limited window. | planned |

## Reporting Vulnerabilities

Please do not open public issues for security problems. Email security@<your-domain> with details. We will acknowledge within 72 hours.

See [README section 19](README.md#19-security-considerations) for the complete security considerations.