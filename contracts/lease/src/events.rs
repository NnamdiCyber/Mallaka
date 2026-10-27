//! Event definitions for the Mallaka lease contract.

use soroban_sdk::{contracttype, Address, Bytes, Env};

/// Topics for lease_created: [lease_id, lessor, lessee]
/// Data: terms hash
pub fn lease_created(
    env: &Env,
    lease_id: u64,
    lessor: &Address,
    lessee: &Address,
    terms: &crate::types::Terms,
) {
    let topics = (lease_id, lessor.clone(), lessee.clone());
    // Create a hash of terms for data
    let mut buf = [0u8; 72];
    buf[0..16].copy_from_slice(&terms.total_price.to_be_bytes());
    buf[16..32].copy_from_slice(&terms.deposit.to_be_bytes());
    buf[32..48].copy_from_slice(&terms.installment.to_be_bytes());
    buf[48..56].copy_from_slice(&terms.interval.to_be_bytes());
    buf[56..64].copy_from_slice(&terms.grace.to_be_bytes());
    buf[64..72].copy_from_slice(&lease_id.to_be_bytes());
    let terms_bytes = Bytes::from_slice(env, &buf);
    let hash = env.crypto().sha256(&terms_bytes);
    env.events().publish(("lease_created", topics), hash);
}

/// Topics for activated: [lease_id]
/// Data: start_ts, deposit
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActivatedData {
    pub start_ts: u64,
    pub deposit: i128,
}

pub fn activated(env: &Env, lease_id: u64, start_ts: u64, deposit: i128) {
    let topics = (lease_id,);
    let data = ActivatedData { start_ts, deposit };
    env.events().publish(("activated", topics), data);
}

/// Topics for payment: [lease_id, payer]
/// Data: amount, paid_total, next_due
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentData {
    pub amount: i128,
    pub paid_total: i128,
    pub next_due: u64,
}

pub fn payment(
    env: &Env,
    lease_id: u64,
    payer: &Address,
    amount: i128,
    paid_total: i128,
    next_due: u64,
) {
    let topics = (lease_id, payer.clone());
    let data = PaymentData {
        amount,
        paid_total,
        next_due,
    };
    env.events().publish(("payment", topics), data);
}

/// Topics for grace_entered: [lease_id]
/// Data: due_ts, grace_ends
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GraceEnteredData {
    pub due_ts: u64,
    pub grace_ends: u64,
}

pub fn grace_entered(env: &Env, lease_id: u64, due_ts: u64, grace_ends: u64) {
    let topics = (lease_id,);
    let data = GraceEnteredData { due_ts, grace_ends };
    env.events().publish(("grace_entered", topics), data);
}

/// Topics for defaulted: [lease_id]
/// Data: arrears
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DefaultedData {
    pub arrears: i128,
}

pub fn defaulted(env: &Env, lease_id: u64, arrears: i128) {
    let topics = (lease_id,);
    let data = DefaultedData { arrears };
    env.events().publish(("defaulted", topics), data);
}

/// Topics for cured: [lease_id]
/// Data: paid_total
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CuredData {
    pub paid_total: i128,
}

pub fn cured(env: &Env, lease_id: u64, paid_total: i128) {
    let topics = (lease_id,);
    let data = CuredData { paid_total };
    env.events().publish(("cured", topics), data);
}

/// Topics for completed: [lease_id, lessee]
/// Data: final_paid
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompletedData {
    pub final_paid: i128,
}

pub fn completed(env: &Env, lease_id: u64, lessee: &Address, final_paid: i128) {
    let topics = (lease_id, lessee.clone());
    let data = CompletedData { final_paid };
    env.events().publish(("completed", topics), data);
}

/// Topics for repossessed: [lease_id]
/// Data: ts
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepossessedData {
    pub ts: u64,
}

pub fn repossessed(env: &Env, lease_id: u64, ts: u64) {
    let topics = (lease_id,);
    let data = RepossessedData { ts };
    env.events().publish(("repossessed", topics), data);
}

/// Topics for cancelled: [lease_id]
/// Data: ts
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CancelledData {
    pub ts: u64,
}

pub fn cancelled(env: &Env, lease_id: u64, ts: u64) {
    let topics = (lease_id,);
    let data = CancelledData { ts };
    env.events().publish(("cancelled", topics), data);
}
