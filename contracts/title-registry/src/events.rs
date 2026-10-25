//! Event definitions for the Mallaka title registry contract.

use soroban_sdk::{Address, BytesN, Env};

pub fn registered(env: &Env, asset_id: &BytesN<32>, owner: &Address) {
    let topics = (asset_id.clone(), owner.clone());
    env.events().publish(("registered", topics), ());
}

pub fn transferred(env: &Env, asset_id: &BytesN<32>, from: &Address, to: &Address) {
    let topics = (asset_id.clone(), from.clone(), to.clone());
    env.events().publish(("transferred", topics), ());
}

pub fn custodian_set(env: &Env, asset_id: &BytesN<32>, custodian: &Address) {
    let topics = (asset_id.clone(), custodian.clone());
    env.events().publish(("custodian_set", topics), ());
}

pub fn custodian_cleared(env: &Env, asset_id: &BytesN<32>) {
    let topics = (asset_id.clone(),);
    env.events().publish(("custodian_cleared", topics), ());
}
