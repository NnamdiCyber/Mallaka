-- Mallaka Core Database Schema
-- Conforms strictly to README section 9 and section 19

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Lessors
CREATE TABLE IF NOT EXISTS lessors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    stellar_address TEXT NOT NULL UNIQUE,
    payout_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Users (Riders and Lessor Staff)
-- Contact info is encrypted at rest (AES-256-GCM application level). No plaintext PII.
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role TEXT NOT NULL CHECK (role IN ('rider', 'lessor_staff', 'admin')),
    lessor_id UUID REFERENCES lessors(id) ON DELETE SET NULL,
    public_key TEXT,
    contact_info_encrypted TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_public_key ON users(public_key) WHERE public_key IS NOT NULL;

-- 3. Assets
CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lessor_id UUID NOT NULL REFERENCES lessors(id) ON DELETE CASCADE,
    vin_or_serial TEXT NOT NULL UNIQUE,
    asset_type TEXT NOT NULL,
    photos JSONB NOT NULL DEFAULT '[]'::jsonb,
    device_id TEXT NOT NULL,
    asset_hash TEXT NOT NULL, -- 32-byte hex hash anchored on-chain
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_device_id ON assets(device_id);
CREATE INDEX IF NOT EXISTS idx_assets_asset_hash ON assets(asset_hash);

-- 4. Leases (Cached lease state mirroring on-chain state)
CREATE TABLE IF NOT EXISTS leases (
    id BIGINT PRIMARY KEY, -- on-chain lease_id: u64
    lessor_id UUID NOT NULL REFERENCES lessors(id),
    asset_id UUID NOT NULL REFERENCES assets(id),
    lessee_id UUID REFERENCES users(id),
    lessor_address TEXT NOT NULL,
    lessee_address TEXT NOT NULL,
    token_address TEXT NOT NULL,
    title_contract_address TEXT NOT NULL,
    total_price NUMERIC(38, 0) NOT NULL,
    deposit NUMERIC(38, 0) NOT NULL,
    installment NUMERIC(38, 0) NOT NULL,
    interval_seconds BIGINT NOT NULL,
    grace_period_seconds BIGINT NOT NULL,
    repossession_wait_seconds BIGINT NOT NULL,
    paid NUMERIC(38, 0) NOT NULL DEFAULT 0,
    start_ts BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('Pending', 'Active', 'Grace', 'Defaulted', 'Completed', 'Repossessed', 'Cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leases_status ON leases(status);
CREATE INDEX IF NOT EXISTS idx_leases_lessee ON leases(lessee_address);

-- 5. Payments
-- provider_reference is UNIQUE to ensure strict idempotency across provider retries
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lease_id BIGINT NOT NULL REFERENCES leases(id),
    payer_address TEXT NOT NULL,
    naira_amount NUMERIC(18, 2) NOT NULL,
    token_amount NUMERIC(38, 0) NOT NULL,
    fx_rate NUMERIC(18, 6) NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('paystack', 'flutterwave', 'manual')),
    provider_reference TEXT NOT NULL UNIQUE,
    tx_hash TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_lease_id ON payments(lease_id);
CREATE INDEX IF NOT EXISTS idx_payments_tx_hash ON payments(tx_hash) WHERE tx_hash IS NOT NULL;

-- 6. Chain Events
-- Stores raw events plus ledger cursor; unique on (tx_hash, event_index) per design notes
CREATE TABLE IF NOT EXISTS chain_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    event_index INTEGER NOT NULL,
    ledger_sequence BIGINT NOT NULL,
    ledger_closed_at TIMESTAMPTZ NOT NULL,
    topics JSONB NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_chain_events_tx_index UNIQUE (tx_hash, event_index)
);

CREATE INDEX IF NOT EXISTS idx_chain_events_ledger ON chain_events(ledger_sequence);
CREATE INDEX IF NOT EXISTS idx_chain_events_contract_name ON chain_events(contract_id, event_name);

-- 7. Lock Commands
-- Every lock/unlock command, who or what triggered it, and the result
CREATE TABLE IF NOT EXISTS lock_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lease_id BIGINT NOT NULL REFERENCES leases(id),
    asset_id UUID NOT NULL REFERENCES assets(id),
    device_id TEXT NOT NULL,
    command TEXT NOT NULL CHECK (command IN ('lock', 'unlock')),
    triggered_by TEXT NOT NULL,
    two_person_approved_by TEXT,
    status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'acknowledged', 'failed')),
    result_details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lock_commands_lease ON lock_commands(lease_id);
CREATE INDEX IF NOT EXISTS idx_lock_commands_device ON lock_commands(device_id);

-- 8. Audit Log
-- Append-only record of admin actions. UPDATE and DELETE are prohibited by trigger.
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    details JSONB NOT NULL,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce append-only semantics on audit_log
CREATE OR REPLACE FUNCTION enforce_audit_log_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log table is append-only. UPDATE and DELETE operations are prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_prevent_mutation ON audit_log;
CREATE TRIGGER audit_log_prevent_mutation
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION enforce_audit_log_append_only();
