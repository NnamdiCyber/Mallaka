//! Mallaka Title Registry Contract
//! Minimal asset title registry for escrow and transfer.

#![no_std]
#![deny(clippy::all)]

mod errors;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

pub use crate::errors::Error;
pub use crate::types::{AssetRecord, TitleEntry};

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

#[contract]
pub struct TitleRegistry;

#[contractimpl]
impl TitleRegistry {
    /// Initialize the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        storage::set_admin(&env, &admin);
    }

    /// Register an asset title under an owner. Fails if already registered.
    pub fn register(env: Env, asset_id: BytesN<32>, owner: Address) {
        owner.require_auth();
        if storage::owner_of(&env, &asset_id).is_some() {
            panic!("{}", Error::AlreadyRegistered as u32);
        }
        let entry = TitleEntry {
            asset_id: asset_id.clone(),
            owner: owner.clone(),
            custodian: None,
        };
        storage::save_entry(&env, &entry);
        events::registered(&env, &asset_id, &owner);
    }

    /// Get the owner of an asset.
    pub fn owner_of(env: Env, asset_id: BytesN<32>) -> Option<Address> {
        storage::owner_of(&env, &asset_id)
    }

    /// Set an escrow custodian for an asset. Only the owner can call this.
    pub fn set_custodian(env: Env, asset_id: BytesN<32>, custodian: Address) {
        let entry = storage::load_entry(&env, &asset_id).expect("entry not found");
        entry.owner.require_auth();
        let mut entry = entry;
        entry.custodian = Some(custodian.clone());
        storage::save_entry(&env, &entry);
        events::custodian_set(&env, &asset_id, &custodian);
    }

    /// Clear the escrow custodian for an asset. Only the owner can call this.
    pub fn clear_custodian(env: Env, asset_id: BytesN<32>) {
        let entry = storage::load_entry(&env, &asset_id).expect("entry not found");
        entry.owner.require_auth();
        let mut entry = entry;
        entry.custodian = None;
        storage::save_entry(&env, &entry);
        events::custodian_cleared(&env, &asset_id);
    }

    /// Transfer an asset title. Requires auth from `from`.
    pub fn transfer(env: Env, asset_id: BytesN<32>, from: Address, to: Address) {
        from.require_auth();
        let mut entry = storage::load_entry(&env, &asset_id).expect("entry not found");

        if entry.owner != from {
            panic!("{}", Error::NotOwner as u32);
        }

        entry.owner = to.clone();
        entry.custodian = None; // Clear custodian on transfer
        storage::save_entry(&env, &entry);
        events::transferred(&env, &asset_id, &from, &to);
    }

    /// Get the full entry for an asset.
    pub fn get_entry(env: Env, asset_id: BytesN<32>) -> Option<TitleEntry> {
        storage::load_entry(&env, &asset_id)
    }
}
