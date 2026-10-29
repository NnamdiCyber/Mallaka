# ADR-011: Payments pipeline states, retry safety and overpayment

## Status

Accepted (sprint default)

## Context

README 9 says webhooks are idempotent by provider reference and README 19 says a payment is credited once. The contract has no idempotency key on `pay`, and it rejects overpayment (`Overpayment`, README 8.3). The `payments.status` column allows `pending`, `submitted`, `confirmed`, `failed`.

## Options Considered

1. Re-build and re-submit a new transaction on every retry.
2. Persist the signed transaction and its hash before sending. On retry, look the hash up first and only re-send the same signed transaction (or rebuild only when the old one has expired and was never seen on chain).

## Decision

Option 2. Status meanings:

- `pending`: verified webhook recorded, on-chain `pay` not final. Retryable.
- `submitted`: signed transaction sent, outcome unknown. Resolved by hash lookup.
- `confirmed`: settled, the transaction is final.
- `failed`: last attempt failed. Still retryable until `needs_review` is set after the maximum attempts.

A payment is settled only when the transaction is final. Re-sending the same signed transaction cannot double-apply because the network deduplicates by hash and sequence number.

Overpayment: the service re-reads `remaining_balance` from the chain, sends `min(token_amount, remaining)`, and records the excess (`excess_token_amount`, `excess_naira_amount`, `refund_flagged`) plus an `audit_log` entry for manual refund. No refund logic exists beyond the flag.

`payment_intents` (ADR-010) hold the lease, payer and expected provider for each reference; webhook metadata is never trusted for those.

TODO (README 22 item 7): who bears FX risk is undecided. The FX provider records the rate and its source on every payment and nothing more.

## Consequences

- Retries are safe even after a poll timeout.
- Funds received but not applied are always visible in `payments`.

## README Sections Affected

- Sections 8.3, 9, 12, 19, 22 (item 7)

## Date

2026-10-29
