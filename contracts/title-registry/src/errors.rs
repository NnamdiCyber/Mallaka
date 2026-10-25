//! Error definitions for the Mallaka title registry contract.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    Unauthorized = 2,
    AlreadyRegistered = 3,
    NotOwner = 4,
    InvalidState = 5,
}
