# Runbook: Soroban RPC Provider Outage and Failover

## Overview
Mallaka services (`api`, `keeper`, `sponsor`, `indexer`) communicate with Stellar Soroban via RPC endpoints (`SOROBAN_RPC_URL`). If the primary RPC provider experiences downtime, high latency, or rate limiting, on-chain state reads and transaction submissions will degrade or fail open.

---

## Symptoms & Alerts
- Prometheus alert: `soroban_rpc_errors_high` or `chain_read_timeout`.
- Error logs in services with code `CHAIN_UNAVAILABLE` or `RPC network timeout`.
- Indexer lag increasing: `indexer_cursor_lag_ledgers > 50`.
- Sponsor queue building up: BullMQ `sponsor-transactions` backlog growing.

---

## Safety Guarantees
- **Fail Open Discipline (README Section 11):** Lock bridge refuses to lock vehicles if the RPC or chain is unreachable (`fail_open`). Vehicles are never immobilized due to infrastructure outages.
- **Transaction Idempotency:** The payment processor stores signed transaction XDRs and hashes in Postgres before submission. Retrying against a fallback RPC will safely check the transaction hash first without double-charging riders.

---

## Remediation Steps

### 1. Verify Outage
Test the RPC endpoint with `curl`:
```bash
curl -X POST "$SOROBAN_RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```
Expected response:
```json
{"jsonrpc":"2.0","id":1,"result":{"status":"healthy"}}
```

### 2. Switch to Backup RPC Provider
Update `SOROBAN_RPC_URL` in Kubernetes ConfigMap or production `.env`:
* **Primary (e.g. Blockdaemon / QuickNode):** `https://stellar-soroban-rpc.primary.example.com`
* **Backup (e.g. Public / FastNode):** `https://soroban-mainnet.stellar.org` (or configured private mirror)

On Kubernetes:
```bash
kubectl set env deployment -l app.kubernetes.io/part-of=mallaka SOROBAN_RPC_URL="https://backup-rpc.stellar.org" -n mallaka
kubectl rollout restart deployment -l app.kubernetes.io/part-of=mallaka -n mallaka
```

### 3. Verify Recovery
1. Monitor the indexer logs:
   ```bash
   kubectl logs -f deployment/indexer -n mallaka
   ```
   Confirm ledger sequence advances: `"Processed ledger <N>"`.
2. Inspect payment queue:
   ```bash
   kubectl exec -it deployment/api -n mallaka -- node -e "/* check queue backlog */"
   ```
3. Check lock bridge safety audit table:
   ```sql
   SELECT created_at, triggered_by, status, result_details
   FROM lock_commands WHERE result_details->>'failOpen' = 'true'
   ORDER BY created_at DESC LIMIT 10;
   ```
