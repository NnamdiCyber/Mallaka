# Operational Runbook: Keeper Stopped or Lagging

## 1. Overview & Context

The **Keeper service** (`services/keeper/`) runs a scheduled background loop that performs two essential maintenance operations:
1. **`check_default(lease_id)`:** Evaluates overdue installments against ledger close time and transitions eligible leases from `Active` to `Grace`, or `Grace` to `Defaulted`.
2. **`extend_ttl(lease_id)`:** Extends Soroban persistent storage TTL so active lease entries are never pruned by the network mid-lease.

If the keeper stops or lags behind the ledger clock, default enforcement is delayed, notices are not triggered, and persistent entries risk eviction.

---

## 2. Severity & Alerts

- **Severity:** High (P2). Delays contract state advancement and may delay lock safety workflows.
- **Alert Trigger:**
  - Alert `KeeperLagging`: Keeper loop duration or last run timestamp > `3 * KEEPER_INTERVAL_SECONDS` (default > 180 seconds).
  - Alert `LeaseDefaultUnprocessed`: A lease has `now > next_due + grace` but remains in `Grace` or `Active` on-chain for > 1 hour.

---

## 3. Diagnosis Steps

1. **Verify Keeper Process and Container Health:**
   ```bash
   # Check container status
   docker compose ps keeper

   # Inspect recent service logs
   docker compose logs --tail=100 -f keeper
   ```

2. **Inspect Error Patterns:**
   - **RPC Connection Failure / HTTP 502 / 504:**
     Look for `SorobanRpcError` or `fetch failed` in logs. The RPC provider may be down or rate-limiting.
   - **Sequence Number Mismatch (`tx_bad_seq`):**
     Indicates multiple instances are using the same Keeper signer account concurrently without sequential queuing.
   - **Keeper Account Low on XLM:**
     Keeper transactions require network base fees. Check balance:
     ```bash
     stellar keys fund keeper --network testnet # or inspect account on Stellar Expert
     ```

3. **Check Database Lease Queue:**
   Run a diagnostic query against PostgreSQL:
   ```sql
   SELECT id, status, next_due, arrears
   FROM leases
   WHERE status IN ('Active', 'Grace')
     AND next_due < EXTRACT(EPOCH FROM NOW()) - 3600
   ORDER BY next_due ASC;
   ```

---

## 4. Remediation

### Action 1: Restart the Keeper Service
```bash
docker compose restart keeper
# Verify healthy startup in logs
docker compose logs --tail=50 keeper
```

### Action 2: Manual Fallback State Advancement (CLI)
Because `check_default` and `extend_ttl` are permissionless (README Section 7.7), any operator can invoke them manually using the Stellar CLI:

```bash
# Check default on a lagging lease
stellar contract invoke \
  --id "$LEASE_CONTRACT_ID" \
  --source keeper \
  --network "$STELLAR_NETWORK" -- \
  check_default \
  --lease_id <LAGGING_LEASE_ID>

# Extend storage TTL for leases nearing expiry
stellar contract invoke \
  --id "$LEASE_CONTRACT_ID" \
  --source keeper \
  --network "$STELLAR_NETWORK" -- \
  extend_ttl \
  --lease_id <LEASE_ID>
```

### Action 3: Failover to Secondary RPC
If the primary Soroban RPC is unreachable, update `SOROBAN_RPC_URL` in `.env` or container environment to a backup endpoint and restart keeper.

---

## 5. Verification

1. Verify `Keeper processed batch successfully` appears in `services/keeper` logs.
2. Verify updated on-chain status reflects in database via indexer.
3. Confirm storage TTL is bumped.
