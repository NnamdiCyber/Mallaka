# Runbook: Disputed Payment Reconciliation

## Overview
Mallaka runs a daily automated reconciliation worker (`services/payments/src/reconciliation.ts`) that compares verified provider payments (Paystack, Flutterwave) against indexed on-chain `payment` events. Discrepancies raise alerts and require human review.

---

## Mismatch Categories

| Mismatch Kind | Cause | Remediation |
|---|---|---|
| `missing_on_chain` | Fiat received by payment provider, but on-chain Soroban payment transaction never landed or failed. | Investigate `payments.signed_tx_xdr` and sponsor wallet balance. Re-submit via sponsor queue if valid. |
| `amount_mismatch` | On-chain applied amount differs from fiat equivalent. | Inspect FX quote and recorded excess. Initiate partial refund via provider dashboard. |
| `stuck_unsettled` | Payment has remained in `pending` or `submitted` status longer than 60 minutes. | Check Horizon transaction hash or query provider verify endpoint. |

---

## Investigation Steps

### 1. Identify Flagged Payment
Query payments with `needs_review = true` or `refund_flagged = true`:
```sql
SELECT id, lease_id, payer_address, naira_amount, token_amount, applied_token_amount,
       excess_naira_amount, provider, provider_reference, status, tx_hash, created_at
FROM payments
WHERE refund_flagged = TRUE OR needs_review = TRUE OR status = 'failed'
ORDER BY created_at DESC;
```

### 2. Verify External Provider Record
Check transaction reference on Paystack or Flutterwave:
```bash
curl -H "Authorization: Bearer $PAYSTACK_SECRET_KEY" \
  "https://api.paystack.co/transaction/verify/$PROVIDER_REF"
```
Confirm:
- Status is `"success"`
- Amount matches `payments.naira_amount * 100` (in kobo)
- Currency is `"NGN"`

### 3. Check On-Chain Transaction Hash
If `tx_hash` is present in database:
```bash
curl -s "$HORIZON_URL/transactions/$TX_HASH" | jq '{successful: .successful, ledger: .ledger}'
```
- If transaction **failed** on-chain with `Overpayment`: The lease was already completed before this payment arrived. The full amount in `excess_naira_amount` must be refunded to the rider's bank account.
- If transaction **never reached Horizon**: Re-queue the payment job for the `payments:processor` worker.

### 4. Resolving Manual Refunds
Once excess funds are refunded via Paystack/Flutterwave dashboard:
```sql
UPDATE payments
SET refund_flagged = FALSE,
    needs_review = FALSE,
    updated_at = NOW()
WHERE id = '$PAYMENT_ID';

INSERT INTO audit_log (actor, action, resource, details)
VALUES ('operator_username', 'refund_resolved', 'payment:$PAYMENT_ID', '{"refund_reference": "REF_12345"}');
```
