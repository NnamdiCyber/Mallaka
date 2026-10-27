//! Token interface for the Mallaka lease contract.
//! Defines the standard Soroban token interface for USDC SAC transfers.

use soroban_sdk::{token::Client as SorobanTokenClient, Address, Env};

pub struct TokenClient<'a> {
    client: SorobanTokenClient<'a>,
}

impl<'a> TokenClient<'a> {
    pub fn new(env: &'a Env, contract: &Address) -> Self {
        TokenClient {
            client: SorobanTokenClient::new(env, contract),
        }
    }

    /// Transfer `amount` from `from` to `to`. Requires `from.require_auth()`.
    pub fn transfer(&self, from: &Address, to: &Address, amount: &i128) {
        self.client.transfer(from, to, amount);
    }
}
