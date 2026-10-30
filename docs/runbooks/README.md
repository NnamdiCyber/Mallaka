# Operational Runbooks

This directory contains production and staging runbooks for Mallaka operators and infrastructure engineers, as outlined in [README Section 18 (Deployment)](../../README.md#operational-runbooks-docsrunbooks).

---

## Implemented Runbooks

| Runbook | Status | Description |
|---|---|---|
| [`keeper-stopped-or-lagging.md`](./keeper-stopped-or-lagging.md) | **Implemented** | Diagnosing and recovering from keeper scheduler failure, lagging defaults, and storage TTL expiration. |
| [`sponsor-account-low-balance.md`](./sponsor-account-low-balance.md) | **Implemented** | Handling fee-sponsor balance depletion and refilling native XLM reserves on testnet and mainnet. |

---

## Open Runbooks for Contributors (`good first issue`)

Per README section 18 and 23, the following runbooks are intentionally open for community contribution:

1. **RPC provider outage and failover:** Steps to detect RPC node failure, configure fallback nodes, and verify block synchronization.
2. **Indexer gap recovery from ledger cursor:** Procedure for rewinding or fast-forwarding the `chain_events` cursor after database corruption or extended indexer downtime.
3. **Lock bridge stuck or device unreachable:** Troubleshooting IoT device connectivity drops, MQTT broker issues, and manual override verification.
4. **Disputed payment reconciliation:** Process for investigating mismatches between payment provider references, fiat amounts, and on-chain ledger events.

See [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for contribution guidelines.
