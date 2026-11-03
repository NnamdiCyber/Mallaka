# Operational Runbooks

This directory contains production and staging runbooks for Mallaka operators and infrastructure engineers, as outlined in [README Section 18 (Deployment)](../../README.md#operational-runbooks-docsrunbooks).

---

## Implemented Runbooks

| Runbook | Status | Description |
|---|---|---|
| [`keeper-stopped-or-lagging.md`](./keeper-stopped-or-lagging.md) | **Implemented** | Diagnosing and recovering from keeper scheduler failure, lagging defaults, and storage TTL expiration. |
| [`sponsor-account-low-balance.md`](./sponsor-account-low-balance.md) | **Implemented** | Handling fee-sponsor balance depletion and refilling native XLM reserves on testnet and mainnet. |
| [`rpc-provider-outage.md`](./rpc-provider-outage.md) | **Implemented** | Detecting Soroban RPC downtime, executing automated/manual failover, and validating block sync. |
| [`indexer-gap-recovery.md`](./indexer-gap-recovery.md) | **Implemented** | Inspecting and rewinding the `chain_events` ledger cursor to backfill missed on-chain events safely. |
| [`lock-bridge-disconnection.md`](./lock-bridge-disconnection.md) | **Implemented** | Diagnosing IoT tracker connectivity failures, verifying fail-open safety, and triggering manual overrides. |
| [`reconciliation-dispute.md`](./reconciliation-dispute.md) | **Implemented** | Resolving discrepancies between Paystack/Flutterwave fiat payments and Soroban on-chain execution. |

---

See [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for contribution guidelines.
