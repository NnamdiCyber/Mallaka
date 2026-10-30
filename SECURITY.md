# Security Policy

## Reporting Vulnerabilities

We take the security of Mallaka seriously. If you believe you have discovered a vulnerability in any part of this repository (smart contracts, off-chain backend services, rider PWA, lessor dashboard, USSD gateway, or infrastructure templates), please **do not open a public issue or discuss it in public channels**.

Instead, please send an encrypted or private email to:

```text
security@example.com   # PLACEHOLDER: Replace with actual security team email before production deployment
```

### What to Include

To help us investigate and resolve the issue quickly, please provide:
1. A description of the vulnerability, including severity and potential impact.
2. Steps to reproduce the vulnerability, proof of concept (PoC) code, or test scenario.
3. Affected components, contracts, commit hashes, or service versions.
4. Any potential mitigations or workarounds you have identified.

### Response and Acknowledgment Policy

- **Initial acknowledgment:** We commit to acknowledging receipt of your security vulnerability report within **72 hours**.
- **Assessment:** We will validate and triage the issue, providing a status update and estimated resolution timeline.
- **Coordination:** We request that you observe coordinated vulnerability disclosure (CVD) and allow us reasonable time to deploy a fix before any public disclosure.
- **Credit:** We will gladly credit reporters in our release notes and security advisories once the fix is deployed (unless you request anonymity).

---

## Security Principles

As outlined in [README Section 19](README.md#19-security-considerations):

| Area | Safeguards |
|---|---|
| **Contract correctness** | Checked arithmetic, explicit state machine, exhaustive unit and scenario tests, formal audit before mainnet |
| **Authorization** | `require_auth` on every state-changing call. Only `check_default` and `extend_ttl` are permissionless. |
| **Key management** | Sponsor, keeper, and custodial keys held in KMS/Vault with least privilege. DevSigner is strictly forbidden on mainnet. |
| **Admin and upgrade risk** | Admin actions behind multisig. Immutable or time-locked upgrade paths. |
| **Webhook security** | Cryptographic signature verification, replay protection, and idempotency keys on all payment rails. |
| **Double-credit and reconciliation** | Payments credited exactly once via DB unique constraints. Daily automated reconciliation between provider records and on-chain events. |
| **Lock misuse** | Bridge re-reads on-chain state before commands, fails open on RPC failure, logs every action, and requires two-person approval for manual locks above configured thresholds. |
| **Privacy** | Zero personal data on-chain. Sensitive PII encrypted at rest using AES-256-GCM. Log redaction active across all services. |
| **Denial of service** | Rate limiting at API gateway. Permissionless operations are idempotent and cheap. |
| **Dependency risk** | Version pinning, committed lockfiles, and routine audits. |
| **Event retention** | Dedicated indexer persists all contract events and ledger cursors into Postgres to prevent data loss from RPC pruning. |
