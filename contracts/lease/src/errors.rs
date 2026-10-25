//! Error definitions for the Mallaka lease contract.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    Unauthorized = 2,
    InvalidTerms = 3,
    InvalidState = 4,
    InvalidAmount = 5,
    AlreadyActive = 6,
    NotDefaulted = 7,
    RepossessionTooEarly = 8,
    Overpayment = 9,
    MathOverflow = 10,
}
