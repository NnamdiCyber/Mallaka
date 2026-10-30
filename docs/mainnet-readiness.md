# Mainnet Readiness Checklist

This document mirrors and tracks the production release requirements specified in [README Section 18 (Deployment)](#18-deployment). 

> **Important Notice:** The Mallaka protocol is currently deployed on **Stellar Testnet only**. The system is **NOT** audited and **NOT** yet production-ready for live customer funds or mainnet assets.

---

## Contract Release Checklist

| Requirement | Status | Verification & Evidence | Next Steps |
|---|---|---|---|
| **All tests pass, including property-based tests** | **DONE** | 73 Cargo unit/scenario tests + proptest suites passing (`cargo test`). TypeScript integration suites passing across all packages. | Maintain continuous CI verification on every PR. |
| **Independent security audit completed and findings resolved** | **NOT DONE** | No external audit has been conducted yet. | Engage reputable smart contract security auditing firms (Stellar/Soroban ecosystem specialists) prior to any mainnet deployment. |
| **Contract WASM hash recorded and published** | **IN PROGRESS** | Local and testnet deployment scripts record hashes; WASM builds reproducible via `stellar contract build`. | Automate reproducible deterministic build and publish WASM hash in GitHub Release tags for mainnet. |
| **Upgrade and admin-key policy documented** | **IN PROGRESS** | Admin roles defined in contracts and ADR-007; emergency pause and admin auth specified. | Establish multisig (e.g. 3-of-5) governance structure and timelock contract before deploying to mainnet. |
| **Testnet pilot run with real riders using test funds** | **NOT DONE** | Automated end-to-end scenario validated on testnet with mock/simulated rails; real-world pilot with human riders and physical assets has not occurred. | Execute phase 5 pilot with partner lessor fleet in Lagos before mainnet launch. |
| **Runbooks reviewed: keeper, sponsor, RPC, indexer, lock-bridge, reconciliation** | **IN PROGRESS** | Core operational runbooks drafted in `docs/runbooks/` (`keeper-stopped-or-lagging.md`, `sponsor-account-low-balance.md`). Remaining runbooks scheduled for community contribution. | Complete remaining runbooks for RPC provider outage, indexer gap recovery, lock bridge disconnection, and reconciliation dispute resolution. |

---

## Technical and Operational Prerequisites for Mainnet

1. **Hardware Security Module (HSM) / KMS Signer:**
   - DevSigner is strictly disallowed on `mainnet` (enforced by `ConfigSchema` and `DevSigner` constructor).
   - Cloud KMS / HashiCorp Vault must be configured for all operational signers (Sponsor, Keeper, Custodial Payer).
2. **Secrets Scanning & CI Hardening:**
   - Automated secret scanning (Gitleaks) active in CI pipeline.
   - Zero hardcoded keys or live credentials in codebase or git history.
3. **Audit Trail & Observability:**
   - PostgreSQL append-only audit logging table verified with immutability triggers.
   - Sentry error monitoring and Prometheus metrics endpoints hooked up in production environments.
4. **Legal and Regulatory Review:**
   - Legal review of hire-purchase contracts under Nigerian law (NDPA, consumer credit compliance, vehicle remote immobilization safety regulations).
