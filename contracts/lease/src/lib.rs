//! Mallaka Lease Contract
//! Core lease logic: terms, payments, state transitions, title release.

#![no_std]
#![deny(clippy::all)]

mod errors;
mod events;
mod schedule;
mod storage;
mod title;
mod token;
mod types;

#[cfg(test)]
mod test;

pub use crate::errors::Error;
pub use crate::types::{Lease, Status, Terms};

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

#[contract]
pub struct LeaseContract;

#[contractimpl]
impl LeaseContract {
    /// Initialize the contract with admin and protocol version.
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        storage::set_admin(&env, &admin);
        storage::set_next_lease_id(&env, &1);
    }

    /// Create a new lease. Called by the lessor.
    #[allow(clippy::too_many_arguments)]
    pub fn create_lease(
        env: Env,
        lessor: Address,
        lessee: Address,
        asset_id: BytesN<32>,
        title_contract: Address,
        token: Address,
        total_price: i128,
        deposit: i128,
        installment: i128,
        interval: u64,
        grace: u64,
    ) -> u64 {
        lessor.require_auth();
        let terms = Terms {
            total_price,
            deposit,
            installment,
            interval,
            grace,
        };
        crate::schedule::validate_terms(&terms).expect("invalid terms");

        // Escrow the title in this contract
        let title_client = crate::title::TitleClient::new(&env, &title_contract);
        title_client.set_custodian(&asset_id, &env.current_contract_address());

        let lease_id = storage::get_next_lease_id(&env);
        storage::set_next_lease_id(&env, &(lease_id + 1));

        let lease = Lease {
            id: lease_id,
            lessor: lessor.clone(),
            lessee: lessee.clone(),
            asset_id,
            title_contract,
            token,
            total_price,
            deposit,
            installment,
            interval,
            grace,
            paid: 0,
            start_ts: 0,
            status: Status::Pending,
            repossession_wait: 86400 * 7, // Default 7 days, per ADR-002
        };

        storage::save_lease(&env, &lease);

        // Emit lease_created event
        events::lease_created(&env, lease_id, &lessor, &lessee, &terms);

        lease_id
    }

    /// Activate a pending lease. Called by the lessee.
    pub fn activate(env: Env, lease_id: u64) {
        let mut lease = storage::load_lease(&env, lease_id).expect("lease not found");
        lease.lessee.require_auth();

        if lease.status != Status::Pending {
            panic!("{}", Error::InvalidState as u32);
        }

        // Transfer deposit from lessee to lessor if deposit > 0
        if lease.deposit > 0 {
            let token_client = crate::token::TokenClient::new(&env, &lease.token);
            token_client.transfer(&lease.lessee, &lease.lessor, &lease.deposit);
        }

        // Set start timestamp and status
        lease.start_ts = env.ledger().timestamp();
        lease.status = Status::Active;

        storage::save_lease(&env, &lease);
        storage::extend_ttl(&env, lease_id);

        events::activated(&env, lease_id, lease.start_ts, lease.deposit);
    }

    /// Make a payment. Called by any payer.
    pub fn pay(env: Env, lease_id: u64, payer: Address, amount: i128) {
        payer.require_auth();

        if amount <= 0 {
            panic!("{}", Error::InvalidAmount as u32);
        }

        let mut lease = storage::load_lease(&env, lease_id).expect("lease not found");

        match lease.status {
            Status::Active | Status::Grace | Status::Defaulted => {}
            _ => panic!("{}", Error::InvalidState as u32),
        }

        let remaining = lease
            .total_price
            .checked_sub(lease.deposit)
            .expect("overflow")
            .checked_sub(lease.paid)
            .expect("overflow");
        if amount > remaining {
            panic!("{}", Error::Overpayment as u32);
        }

        // Transfer from payer to lessor via token interface
        let token_client = crate::token::TokenClient::new(&env, &lease.token);
        token_client.transfer(&payer, &lease.lessor, &amount);

        lease.paid = lease.paid.checked_add(amount).expect("overflow");

        let prev_status = lease.status;
        let now = env.ledger().timestamp();

        // Recompute status
        let derived = crate::schedule::derive_status(
            now,
            lease.start_ts,
            lease.interval,
            lease.grace,
            lease.paid,
            lease.installment,
            lease.total_price,
            lease.deposit,
        );
        lease.status = derived;

        storage::save_lease(&env, &lease);
        storage::extend_ttl(&env, lease_id);

        let next_due = crate::schedule::next_due(
            lease.start_ts,
            lease.interval,
            lease.paid,
            lease.installment,
        );
        events::payment(&env, lease_id, &payer, amount, lease.paid, next_due);

        // Check for cured event (ADR-001)
        if (prev_status == Status::Grace || prev_status == Status::Defaulted)
            && derived == Status::Active
        {
            events::cured(&env, lease_id, lease.paid);
        }

        // Check for completion (ADR-003): transfer title to lessee
        if derived == Status::Completed {
            let title_client = crate::title::TitleClient::new(&env, &lease.title_contract);
            title_client.transfer(&lease.asset_id, &lease.lessor, &lease.lessee);
            events::completed(&env, lease_id, &lease.lessee, lease.paid);
        }
    }

    /// Check for default. Permissionless. Idempotent.
    pub fn check_default(env: Env, lease_id: u64) -> Status {
        let mut lease = storage::load_lease(&env, lease_id).expect("lease not found");

        match lease.status {
            Status::Active | Status::Grace => {}
            _ => return lease.status,
        }

        let now = env.ledger().timestamp();
        let nd = crate::schedule::next_due(
            lease.start_ts,
            lease.interval,
            lease.paid,
            lease.installment,
        );
        let grace_end = nd.saturating_add(lease.grace);

        if now > grace_end {
            if lease.status != Status::Defaulted {
                lease.status = Status::Defaulted;
                storage::save_lease(&env, &lease);
                storage::extend_ttl(&env, lease_id);

                let arrears = crate::schedule::calculate_arrears(
                    now,
                    lease.start_ts,
                    lease.interval,
                    lease.paid,
                    lease.installment,
                    lease.total_price,
                    lease.deposit,
                );
                events::defaulted(&env, lease_id, arrears);
            }
        } else if now > nd && lease.status == Status::Active {
            lease.status = Status::Grace;
            storage::save_lease(&env, &lease);
            storage::extend_ttl(&env, lease_id);

            events::grace_entered(&env, lease_id, nd, grace_end);
        }

        lease.status
    }

    /// Repossess a defaulted lease. Called by lessor after minimum period.
    pub fn repossess(env: Env, lease_id: u64) {
        let mut lease = storage::load_lease(&env, lease_id).expect("lease not found");
        lease.lessor.require_auth();

        if lease.status != Status::Defaulted {
            panic!("{}", Error::NotDefaulted as u32);
        }

        // Check repossession_wait period per ADR-002: now > next_due + grace + repossession_wait
        let now = env.ledger().timestamp();
        let nd = crate::schedule::next_due(
            lease.start_ts,
            lease.interval,
            lease.paid,
            lease.installment,
        );
        let min_repossess_ts = nd
            .saturating_add(lease.grace)
            .saturating_add(lease.repossession_wait);
        if now <= min_repossess_ts {
            panic!("{}", Error::RepossessionTooEarly as u32);
        }

        // Release title from escrow back to the lessor
        let title_client = crate::title::TitleClient::new(&env, &lease.title_contract);
        title_client.clear_custodian(&lease.asset_id);

        lease.status = Status::Repossessed;
        storage::save_lease(&env, &lease);
        storage::extend_ttl(&env, lease_id);

        events::repossessed(&env, lease_id, now);

        // TODO: Section 22 item 1 - Equity on repossession. Contract currently does not calculate or execute refund or equity settlement on repossession.
    }

    /// Cancel a pending lease. Called by lessor.
    pub fn cancel(env: Env, lease_id: u64) {
        let mut lease = storage::load_lease(&env, lease_id).expect("lease not found");
        lease.lessor.require_auth();

        if lease.status != Status::Pending {
            panic!("{}", Error::InvalidState as u32);
        }

        // Release title from escrow back to the lessor
        let title_client = crate::title::TitleClient::new(&env, &lease.title_contract);
        title_client.clear_custodian(&lease.asset_id);

        lease.status = Status::Cancelled;
        storage::save_lease(&env, &lease);
        storage::extend_ttl(&env, lease_id);

        events::cancelled(&env, lease_id, env.ledger().timestamp());
    }

    /// Get lease by ID. Read-only.
    pub fn get_lease(env: Env, lease_id: u64) -> Lease {
        storage::load_lease(&env, lease_id).expect("lease not found")
    }

    /// Get lease status view. Read-only.
    pub fn get_status(env: Env, lease_id: u64) -> types::LeaseView {
        let lease = storage::load_lease(&env, lease_id).expect("lease not found");
        let now = env.ledger().timestamp();

        let remaining_balance = crate::schedule::installments_remaining_balance(
            lease.total_price,
            lease.deposit,
            lease.paid,
        )
        .unwrap_or(0);
        let next_due = crate::schedule::next_due(
            lease.start_ts,
            lease.interval,
            lease.paid,
            lease.installment,
        );
        let arrears = crate::schedule::calculate_arrears(
            now,
            lease.start_ts,
            lease.interval,
            lease.paid,
            lease.installment,
            lease.total_price,
            lease.deposit,
        );

        let derived = crate::schedule::derive_status(
            now,
            lease.start_ts,
            lease.interval,
            lease.grace,
            lease.paid,
            lease.installment,
            lease.total_price,
            lease.deposit,
        );

        types::LeaseView {
            lease_id: lease.id,
            remaining_balance,
            next_due,
            arrears,
            stored_status: lease.status,
            derived_status: derived,
        }
    }

    /// Extend TTL for a lease. Permissionless.
    pub fn extend_ttl(env: Env, lease_id: u64) {
        storage::extend_ttl(&env, lease_id);
    }
}
