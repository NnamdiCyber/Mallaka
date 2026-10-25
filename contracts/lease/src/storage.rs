//! Storage helpers for the Mallaka lease contract.

use soroban_sdk::{contracttype, Address, Env};

use crate::types::Lease;

const LEASE_TTL_THRESHOLD: u32 = 86400 * 30; // 30 days
const LEASE_TTL_EXTEND: u32 = 86400 * 90; // 90 days

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Lease(u64),
    Admin,
    NextLeaseId,
}

/// Get the admin address from instance storage.
#[allow(dead_code)]
pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

/// Set the admin address in instance storage.
pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

/// Get the next lease ID from instance storage.
pub fn get_next_lease_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextLeaseId)
        .unwrap_or(1)
}

/// Set the next lease ID in instance storage.
pub fn set_next_lease_id(env: &Env, id: &u64) {
    env.storage().instance().set(&DataKey::NextLeaseId, id);
}

/// Load a lease from persistent storage.
pub fn load_lease(env: &Env, lease_id: u64) -> Option<Lease> {
    env.storage().persistent().get(&DataKey::Lease(lease_id))
}

/// Save a lease to persistent storage with TTL extension.
pub fn save_lease(env: &Env, lease: &Lease) {
    env.storage()
        .persistent()
        .set(&DataKey::Lease(lease.id), lease);
    extend_ttl(env, lease.id);
}

/// Extend TTL for a lease entry.
pub fn extend_ttl(env: &Env, lease_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::Lease(lease_id),
        LEASE_TTL_THRESHOLD,
        LEASE_TTL_EXTEND,
    );
}
