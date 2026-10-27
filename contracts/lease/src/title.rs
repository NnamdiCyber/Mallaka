//! Title registry client interface for cross-contract calls.

use soroban_sdk::{contractclient, Address, BytesN, Env};

#[allow(dead_code)]
#[contractclient(name = "TitleClient")]
pub trait TitleRegistryInterface {
    fn set_custodian(env: Env, asset_id: BytesN<32>, custodian: Address);
    fn clear_custodian(env: Env, asset_id: BytesN<32>);
    fn transfer(env: Env, asset_id: BytesN<32>, from: Address, to: Address);
}
