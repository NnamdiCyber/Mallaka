//! Types for the Mallaka title registry contract.

use soroban_sdk::{contracttype, Address, BytesN};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TitleEntry {
    pub asset_id: BytesN<32>,
    pub owner: Address,
    pub custodian: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetRecord {
    pub asset_id: BytesN<32>,
    pub hash: BytesN<32>,
}
