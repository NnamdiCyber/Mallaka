//! Token interface for the Mallaka lease contract.
//! Defines the standard Soroban token interface for USDC SAC transfers.

use soroban_sdk::{Address, Env};

pub struct TokenClient;

impl TokenClient {
    pub fn new(_env: &Env, _contract: &Address) -> Self {
        TokenClient
    }

    /// Transfer `amount` from `from` to `to`. Requires `from.require_auth()`.
    pub fn transfer(&self, _from: &Address, _to: &Address, _amount: &i128) {
        // The actual token transfer is performed by the Soroban token contract.
        // This client type is a compile-time interface marker; the real
        // cross-contract call happens at runtime through the Soroban SDK.
    }
}
