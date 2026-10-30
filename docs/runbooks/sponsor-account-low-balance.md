# Operational Runbook: Sponsor Account Low on Balance

## 1. Overview & Context

Riders and lessors never hold XLM or pay network gas fees directly. The **Fee Sponsor service** (`services/sponsor/`) wraps inner transactions into Stellar **Fee-Bump Transactions** signed by the protocol sponsor account (`SPONSOR_PUBLIC_KEY`). 

The sponsor service continuously monitors its native XLM reserve against `SPONSOR_MIN_BALANCE` (default 100 XLM). If this balance is exhausted, the network rejects fee-bump transactions, preventing rider activations, payment settlements, and contract calls.

---

## 2. Severity & Alerts

- **Severity:**
  - **P2 (High):** Balance drops below `SPONSOR_MIN_BALANCE` (warning threshold; transactions still processing).
  - **P1 (Critical):** Balance reaches 0 or drops below minimum reserve (transactions fail with `tx_bad_auth` or `op_underfunded`).
- **Alert Trigger:**
  - `SponsorBalanceLow`: Fired when `balance < SPONSOR_MIN_BALANCE`.
  - `SponsorQueueBacklog`: Fired when queue `sponsor-transactions` has pending jobs > 50.

---

## 3. Diagnosis Steps

1. **Check Sponsor Account Balance on Stellar:**
   ```bash
   # Check via Stellar CLI
   stellar account "$SPONSOR_PUBLIC_KEY" --network "$STELLAR_NETWORK"

   # Or query Horizon directly:
   curl -s "https://horizon-testnet.stellar.org/accounts/$SPONSOR_PUBLIC_KEY" | jq '.balances'
   ```

2. **Check Sponsor Service Logs:**
   ```bash
   docker compose logs --tail=100 -f sponsor
   ```
   Look for warnings: `Sponsor balance ... XLM is below threshold ... XLM`.

3. **Check Queue Health:**
   Inspect BullMQ Redis queue `sponsor-transactions`:
   ```bash
   docker compose exec redis redis-cli llen "bull:sponsor-transactions:wait"
   ```

---

## 4. Remediation Steps

### On Testnet:
Top up immediately via Stellar Friendbot:
```bash
# Using Stellar CLI:
stellar keys fund sponsor --network testnet

# Or using curl against Friendbot API:
curl "https://friendbot.stellar.org?addr=$SPONSOR_PUBLIC_KEY"
```

### On Mainnet:
1. Authorize an operational transfer of native XLM (e.g. 500–1000 XLM) from the organizational treasury wallet to `SPONSOR_PUBLIC_KEY`.
2. Do **NOT** send funds to the lease contract address or SAC token address; funds must go to the native Stellar sponsor account.
3. Confirm transaction confirmation on Stellar Explorer / Horizon.

### Post-Funding Queue Verification:
Once funded, the sponsor worker will automatically resume dequeuing and submitting waiting transactions.
1. Check that `bull:sponsor-transactions:wait` drops to 0.
2. Confirm payments transition from `submitted` to `confirmed`.

---

## 5. Prevention & Best Practices

1. Set `SPONSOR_MIN_BALANCE` to cover at least 7 days of peak projected volume (at ~0.00001 XLM per transaction, 100 XLM covers ~10,000,000 transactions; set higher if fee surge pricing occurs).
2. Configure PagerDuty / Sentry alerting on balance notifications.
3. Implement automated sweep scripts from treasury accounts when balance drops below 2x threshold.
