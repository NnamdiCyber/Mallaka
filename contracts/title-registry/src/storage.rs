//! Storage helpers for the Mallaka title registry contract.

use soroban_sdk::{contracttype, Address, BytesN, Env};

use crate::types::TitleEntry;

const TITLE_TTL_THRESHOLD: u32 = 86400 * 30; // 30 days
const TITLE_TTL_EXTEND: u32 = 86400 * 90; // 90 days

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Title(BytesN<32>),
    Admin,
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

/// Load a title entry from persistent storage.
pub fn load_entry(env: &Env, asset_id: &BytesN<32>) -> Option<TitleEntry> {
    env.storage()
        .persistent()
        .get(&DataKey::Title(asset_id.clone()))
}

/// Save a title entry to persistent storage with TTL extension.
pub fn save_entry(env: &Env, entry: &TitleEntry) {
    env.storage()
        .persistent()
        .set(&DataKey::Title(entry.asset_id.clone()), entry);
    extend_ttl(env, &entry.asset_id);
}

/// Extend TTL for a title entry.
pub fn extend_ttl(env: &Env, asset_id: &BytesN<32>) {
    env.storage().persistent().extend_ttl(
        &DataKey::Title(asset_id.clone()),
        TITLE_TTL_THRESHOLD,
        TITLE_TTL_EXTEND,
    );
}

/// Get the owner of an asset, if registered.
pub fn owner_of(env: &Env, asset_id: &BytesN<32>) -> Option<Address> {
    load_entry(env, asset_id).map(|e| e.owner)
}
