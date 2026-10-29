# ADR-010: Service-support schema additions and dev signer

## Status

Accepted (sprint default)

## Context

README 9 lists database tables as "indicative" and names eight. The api, payments, lock-bridge and notifier services need a little more state than those eight tables hold:

- OTP login must find a user by phone, but `users.contact_info_encrypted` is randomised ciphertext and cannot be queried.
- OTP codes must be stored (hashed) with expiry and attempt counts.
- A naira payment started by a rider must be remembered so the webhook can find the lease and payer from our own record.
- The lock bridge must prove the rider was notified before locking (README 11).
- Payments need pipeline columns (see ADR-011).
- Writing to the chain on behalf of a custodial party (ADR-008) needs a signer. README 16 only lists `KMS_KEY_ID`.

## Options Considered

1. Put everything in JSON blobs on the existing tables.
2. Add a small additive migration (`002_service_support.sql`) and keep the original eight tables intact.

## Decision

Option 2. Migration `002_service_support.sql` adds `users.phone_hash` (HMAC of the phone, no plaintext), `otp_codes`, `payment_intents`, `rider_notices`, `lock_approvals`, and extra columns on `payments`. Nothing in 001 is renamed or removed.

For development on testnet only, custodial signing keys are read from `DEV_SIGNER_SECRETS` (comma-separated), exactly like the existing `SPONSOR_SECRET_KEY` precedent. The resolver refuses to run on mainnet, where a KMS/Vault-backed resolver (`KMS_KEY_ID`) must be supplied. The service wiring for KMS is not implemented here.

## Consequences

- No personal data is added in plaintext. Phone numbers are only in encrypted blobs or keyed hashes.
- `DEV_SIGNER_SECRETS` is not in README 16. It is dev-only and never committed.

## README Sections Affected

- Section 9 (database tables, additive)
- Section 12 (custody)
- Section 16 (one dev-only variable not listed)

## Date

2026-10-29
