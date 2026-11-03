# Runbook: Indexer Gap Recovery from Ledger Cursor

## Overview
The Mallaka indexer service tracks smart contract events (`activated`, `payment`, `cured`, `defaulted`, `repossessed`, `completed`) by polling Soroban RPC and persisting events to `chain_events` with the current ledger cursor. If the indexer halts or a ledger reorg occurs, operators may need to rewind or fast-forward the cursor.

---

## Symptoms & Alerts
- Alert `indexer_lag_critical`: Indexer cursor `max_ledger` is more than 300 ledgers behind the chain tip.
- Inconsistency: On-chain lease payment confirmed on Horizon/Explorer, but `leases.paid` in Postgres does not match.

---

## Recovery Procedure

### 1. Check Stored Cursor vs Network Ledger Tip
Query the current database cursor:
```sql
SELECT MAX(ledger_sequence) AS current_cursor, MAX(ledger_closed_at) AS last_closed
FROM chain_events;
```
Check the live ledger sequence from Soroban RPC:
```bash
curl -s -X POST "$SOROBAN_RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | jq .result.sequence
```

### 2. Inspect Indexer Service Status
```bash
kubectl logs --tail=100 deployment/indexer -n mallaka
```
If the service crashed due to an unhandled malformed event or RPC timeout, restart the container:
```bash
kubectl rollout restart deployment/indexer -n mallaka
```

### 3. Rewind Cursor (To Re-sync Missing Events)
If events were skipped during a network partition:
1. Stop the indexer worker:
   ```bash
   kubectl scale deployment/indexer --replicas=0 -n mallaka
   ```
2. Delete `chain_events` from the target rewind point (e.g. 500 ledgers back):
   ```sql
   DELETE FROM chain_events WHERE ledger_sequence >= (SELECT MAX(ledger_sequence) - 500 FROM chain_events);
   ```
   *Note: Due to the `UNIQUE (tx_hash, event_index)` constraint and idempotent event processing, replaying events is safe and will not duplicate lock commands or notifications.*
3. Restart the indexer:
   ```bash
   kubectl scale deployment/indexer --replicas=1 -n mallaka
   ```
4. Confirm events are ingested:
   ```bash
   kubectl logs -f deployment/indexer -n mallaka
   ```
