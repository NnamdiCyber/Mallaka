-- Mallaka service-support schema (additive to 001; see ADR-010).
-- README section 9 lists its tables as "indicative". These additions are the
-- minimum needed by api, payments, lock-bridge and notifier. No PII is stored
-- in plaintext: phones are only kept as keyed hashes or encrypted blobs.

-- Deterministic keyed hash of the phone number so OTP login can find a user
-- (contact_info_encrypted is randomised and cannot be queried).
ALTER TABLE users ADD COLUMN phone_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_hash ON users(phone_hash);

-- One-time passcodes. Only a hash of the code is stored.
CREATE TABLE IF NOT EXISTS otp_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_hash TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_codes_phone ON otp_codes(phone_hash);

-- A naira payment the rider started via the API. The webhook handler looks up
-- the lease and payer from OUR record, never from webhook metadata.
CREATE TABLE IF NOT EXISTS payment_intents (
    reference TEXT PRIMARY KEY,
    lease_id BIGINT NOT NULL REFERENCES leases(id),
    user_id UUID REFERENCES users(id),
    payer_address TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('paystack', 'flutterwave')),
    naira_amount NUMERIC(18, 2) NOT NULL,
    checkout_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_lease ON payment_intents(lease_id);

-- Payments pipeline state (ADR-011).
--   status 'pending'   : verified webhook recorded, on-chain pay not yet final (retryable)
--   status 'submitted' : signed tx sent, outcome unknown (resolved by tx_hash lookup)
--   status 'confirmed' : settled, the on-chain transaction is final
--   status 'failed'    : last attempt failed, still retryable until needs_review is set
ALTER TABLE payments ADD COLUMN fx_rate_source TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE payments ADD COLUMN signed_tx_xdr TEXT;
ALTER TABLE payments ADD COLUMN prepared_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN last_error TEXT;
ALTER TABLE payments ADD COLUMN settled_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN applied_token_amount NUMERIC(38, 0);
ALTER TABLE payments ADD COLUMN excess_token_amount NUMERIC(38, 0) NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN excess_naira_amount NUMERIC(18, 2) NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN refund_flagged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE payments ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT FALSE;

-- Rider notices recorded by the notifier. The lock bridge refuses to lock a
-- lease unless a 'grace_entered' and a 'pre_lock' notice exist (README 11).
CREATE TABLE IF NOT EXISTS rider_notices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lease_id BIGINT NOT NULL REFERENCES leases(id),
    kind TEXT NOT NULL,
    channel TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rider_notices_lease ON rider_notices(lease_id, kind);

-- Two-person approval for manual locks above a threshold (README 19, ADR-012).
CREATE TABLE IF NOT EXISTS lock_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lease_id BIGINT NOT NULL REFERENCES leases(id),
    requested_by TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lock_approvals_lease ON lock_approvals(lease_id, status);
