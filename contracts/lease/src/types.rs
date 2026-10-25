//! Core types for the Mallaka lease contract.

use soroban_sdk::{contracttype, Address, BytesN};

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Status {
    Pending = 0,
    Active = 1,
    Grace = 2,
    Defaulted = 3,
    Completed = 4,
    Repossessed = 5,
    Cancelled = 6,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Terms {
    pub total_price: i128,
    pub deposit: i128,
    pub installment: i128,
    pub interval: u64,
    pub grace: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Lease {
    pub id: u64,
    pub lessor: Address,
    pub lessee: Address,
    pub asset_id: BytesN<32>,
    pub title_contract: Address,
    pub token: Address,
    pub total_price: i128,
    pub deposit: i128,
    pub installment: i128,
    pub interval: u64,
    pub grace: u64,
    pub paid: i128,
    pub start_ts: u64,
    pub status: Status,
    /// Minimum seconds after default before repossession is allowed.
    /// Added per ADR-002.
    pub repossession_wait: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LeaseView {
    pub lease_id: u64,
    pub remaining_balance: i128,
    pub next_due: u64,
    pub arrears: i128,
    pub stored_status: Status,
    pub derived_status: Status,
}
