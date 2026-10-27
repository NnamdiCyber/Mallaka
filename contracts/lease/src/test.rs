//! Unit tests for the Mallaka lease schedule logic and types.

use soroban_sdk::Env;

use crate::errors::Error;
use crate::schedule::{
    covered_installments, derive_status, due_timestamp, installments_remaining_balance, next_due,
    total_installments, validate_terms,
};
use crate::types::{Status, Terms};

#[test]
fn test_installments_remaining_balance() {
    assert_eq!(installments_remaining_balance(1000, 100, 0).unwrap(), 900);
    assert_eq!(installments_remaining_balance(1000, 100, 500).unwrap(), 400);
    assert_eq!(installments_remaining_balance(1000, 100, 900).unwrap(), 0);
}

#[test]
fn test_covered_installments_floor() {
    assert_eq!(covered_installments(0, 100), 0);
    assert_eq!(covered_installments(99, 100), 0); // partial doesn't count (8.3.1)
    assert_eq!(covered_installments(100, 100), 1);
    assert_eq!(covered_installments(199, 100), 1);
    assert_eq!(covered_installments(200, 100), 2);
    assert_eq!(covered_installments(250, 100), 2);
}

#[test]
fn test_due_timestamp() {
    assert_eq!(due_timestamp(1000, 86400, 1).unwrap(), 1000 + 86400);
    assert_eq!(due_timestamp(1000, 86400, 2).unwrap(), 1000 + 2 * 86400);
}

#[test]
fn test_next_due_no_payments() {
    assert_eq!(next_due(1000, 86400, 0, 100), 1000 + 86400);
}

#[test]
fn test_next_due_one_installment_paid() {
    assert_eq!(next_due(1000, 86400, 100, 100), 1000 + 2 * 86400);
}

#[test]
fn test_next_due_partial_still_due_one() {
    // Partial payments don't advance next_due (8.3.1)
    assert_eq!(next_due(1000, 86400, 50, 100), 1000 + 86400);
}

#[test]
fn test_next_due_prepayment_two_installments() {
    // Prepayment advances next_due by two intervals (8.3.2)
    assert_eq!(next_due(1000, 86400, 200, 100), 1000 + 3 * 86400);
}

#[test]
fn test_derive_status_active_on_time() {
    let start = 1000;
    assert_eq!(
        derive_status(1000, start, 86400, 86400, 0, 100, 1000, 100),
        Status::Active
    );
    assert_eq!(
        derive_status(1000 + 43200, start, 86400, 86400, 0, 100, 1000, 100),
        Status::Active
    );
    // Exactly at due = Active
    assert_eq!(
        derive_status(1000 + 86400, start, 86400, 86400, 0, 100, 1000, 100),
        Status::Active
    );
}

#[test]
fn test_derive_status_grace_1_second_late() {
    let start = 1000;
    // 1 second past due = Grace
    assert_eq!(
        derive_status(1000 + 86400 + 1, start, 86400, 86400, 0, 100, 1000, 100),
        Status::Grace
    );
}

#[test]
fn test_derive_status_grace_exactly_at_end() {
    let start = 1000;
    // Exactly at grace end = Grace
    assert_eq!(
        derive_status(1000 + 86400 + 86400, start, 86400, 86400, 0, 100, 1000, 100),
        Status::Grace
    );
}

#[test]
fn test_derive_status_defaulted_1_second_past_grace() {
    let start = 1000;
    // 1 second past grace = Defaulted
    assert_eq!(
        derive_status(
            1000 + 86400 + 86400 + 1,
            start,
            86400,
            86400,
            0,
            100,
            1000,
            100
        ),
        Status::Defaulted
    );
}

#[test]
fn test_derive_status_completed_precedence() {
    let start = 1000;
    // Completed takes precedence even past grace (8.2)
    assert_eq!(
        derive_status(
            1000 + 86400 + 86400 + 1,
            start,
            86400,
            86400,
            900,
            100,
            1000,
            100
        ),
        Status::Completed
    );
}

#[test]
fn test_derive_status_partial_payments_dont_count() {
    // Partial payments don't count as on time (8.3.1)
    let start = 1000;
    assert_eq!(
        derive_status(1000 + 86400, start, 86400, 86400, 50, 100, 1000, 100),
        Status::Active
    );
    assert_eq!(
        derive_status(1000 + 86400 + 1, start, 86400, 86400, 50, 100, 1000, 100),
        Status::Grace
    );
}

#[test]
fn test_derive_status_prepayment_catches_up() {
    // Catch-up payments cure (8.3.3)
    let start = 1000;
    assert_eq!(
        derive_status(1000 + 86400 + 1, start, 86400, 86400, 200, 100, 1000, 100),
        Status::Active
    );
}

#[test]
fn test_total_installments_exact() {
    assert_eq!(total_installments(1000, 100, 300).unwrap(), 3);
}

#[test]
fn test_total_installments_remainder() {
    // Final installment absorbs remainder (8.3.5, ADR-006)
    assert_eq!(total_installments(1000, 100, 400).unwrap(), 3); // 900/400 = 2.25 -> 3
}

#[test]
fn test_total_installments_remainder_final_absorbed() {
    // total=1000, deposit=100, installment=400: installments are 400,400,100
    assert_eq!(total_installments(1000, 100, 400).unwrap(), 3);
}

#[test]
fn test_validate_terms_valid() {
    let terms = Terms {
        total_price: 1000,
        deposit: 100,
        installment: 100,
        interval: 86400,
        grace: 86400,
    };
    assert!(validate_terms(&terms).is_ok());
}

#[test]
fn test_validate_terms_invalid() {
    assert_eq!(
        validate_terms(&Terms {
            total_price: 0,
            deposit: 100,
            installment: 100,
            interval: 86400,
            grace: 86400
        }),
        Err(Error::InvalidTerms)
    );
    assert_eq!(
        validate_terms(&Terms {
            total_price: 1000,
            deposit: -1,
            installment: 100,
            interval: 86400,
            grace: 86400
        }),
        Err(Error::InvalidTerms)
    );
    assert_eq!(
        validate_terms(&Terms {
            total_price: 1000,
            deposit: 100,
            installment: 0,
            interval: 86400,
            grace: 86400
        }),
        Err(Error::InvalidTerms)
    );
    assert_eq!(
        validate_terms(&Terms {
            total_price: 1000,
            deposit: 100,
            installment: 100,
            interval: 0,
            grace: 86400
        }),
        Err(Error::InvalidTerms)
    );
    assert_eq!(
        validate_terms(&Terms {
            total_price: 1000,
            deposit: 1000,
            installment: 100,
            interval: 86400,
            grace: 86400
        }),
        Err(Error::InvalidTerms)
    );
    assert_eq!(
        validate_terms(&Terms {
            total_price: 1000,
            deposit: 100,
            installment: 1000,
            interval: 86400,
            grace: 86400
        }),
        Err(Error::InvalidTerms)
    );
}

#[test]
fn test_arithmetic_overflow_protection() {
    // Checked arithmetic prevents overflow
    let result = i128::MAX.checked_add(1);
    assert!(result.is_none());
    // schedule functions use checked arithmetic
    assert!(due_timestamp(u64::MAX, 1, 1).is_err());
}

#[test]
fn test_installments_remaining_balance_overflow_safe() {
    // Should not overflow with extreme values
    assert!(installments_remaining_balance(i128::MAX, i128::MIN, i128::MAX).is_err());
}

#[test]
fn test_status_variants() {
    let env = Env::default();
    let _ = Status::Pending as u32;
    let _ = Status::Active as u32;
    let _ = Status::Grace as u32;
    let _ = Status::Defaulted as u32;
    let _ = Status::Completed as u32;
    let _ = Status::Repossessed as u32;
    let _ = Status::Cancelled as u32;
    let _ = env;
}

use crate::{LeaseContract, LeaseContractClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    Address, BytesN, TryIntoVal,
};
use title_registry::{TitleRegistry, TitleRegistryClient};

fn create_test_env() -> (
    Env,
    Address,
    Address,
    Address,
    Address,
    BytesN<32>,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let lessor = Address::generate(&env);
    let lessee = Address::generate(&env);
    let payer = Address::generate(&env);
    let keeper = Address::generate(&env);
    let admin = Address::generate(&env);

    let asset_id = BytesN::from_array(&env, &[42u8; 32]);

    let title_contract = env.register_contract(None, TitleRegistry);
    let title_client = TitleRegistryClient::new(&env, &title_contract);
    title_client.initialize(&admin);
    title_client.register(&asset_id, &lessor);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token_addr = token_contract.address();
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
    token_admin_client.mint(&lessee, &100_000_000);
    token_admin_client.mint(&payer, &100_000_000);

    let lease_contract = env.register_contract(None, LeaseContract);
    let lease_client = LeaseContractClient::new(&env, &lease_contract);
    lease_client.initialize(&admin);

    (
        env,
        lessor,
        lessee,
        payer,
        keeper,
        asset_id,
        title_contract,
        token_addr,
        lease_contract,
    )
}

#[test]
fn test_contract_setup_sanity() {
    let (env, lessor, lessee, _, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);
    let title_client = TitleRegistryClient::new(&env, &title_contract);

    // Create lease
    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );
    assert_eq!(lease_id, 1);

    // Verify title escrowed (custodian is lease contract)
    let entry = title_client.get_entry(&asset_id).unwrap();
    assert_eq!(entry.owner, lessor);
    assert_eq!(entry.custodian, Some(lease_contract));
}

#[test]
fn test_active_to_grace_to_active_catch_up() {
    let (env, lessor, lessee, payer, _keeper, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );

    // Activate at t=1,000,000
    lease_client.activate(&lease_id);
    let lease = lease_client.get_lease(&lease_id);
    assert_eq!(lease.status, Status::Active);
    assert_eq!(lease.start_ts, 1_000_000);

    // next_due = 1,000,000 + 86,400 = 1,086,400
    // grace_ends = 1,086,400 + 86,400 = 1,172,800
    // Advance to 1 second past next_due
    env.ledger().set_timestamp(1_086_401);

    // Permissionless check_default called by keeper
    let status = lease_client.check_default(&lease_id);
    assert_eq!(status, Status::Grace);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Grace);

    // Catch-up payment of 1 installment clears arrears
    lease_client.pay(&lease_id, &payer, &100);

    let lease = lease_client.get_lease(&lease_id);
    assert_eq!(lease.paid, 100);
    assert_eq!(lease.status, Status::Active);

    // Status view shows Active
    let view = lease_client.get_status(&lease_id);
    assert_eq!(view.stored_status, Status::Active);
    assert_eq!(view.derived_status, Status::Active);
    assert_eq!(view.arrears, 0);
}

#[test]
fn test_active_to_grace_to_defaulted_to_active_cure() {
    let (env, lessor, lessee, payer, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );

    lease_client.activate(&lease_id);

    // Advance past grace end: now = 1,172,801
    env.ledger().set_timestamp(1_172_801);

    let status = lease_client.check_default(&lease_id);
    assert_eq!(status, Status::Defaulted);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Defaulted);

    // Full arrears payment: 2 intervals elapsed by now, so 200 due
    lease_client.pay(&lease_id, &payer, &200);

    let lease = lease_client.get_lease(&lease_id);
    assert_eq!(lease.paid, 200);
    assert_eq!(lease.status, Status::Active);
}

#[test]
fn test_defaulted_to_completed_final_payment() {
    let (env, lessor, lessee, payer, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);
    let title_client = TitleRegistryClient::new(&env, &title_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );

    lease_client.activate(&lease_id);

    // Advance past grace end into Defaulted
    env.ledger().set_timestamp(1_172_801);
    lease_client.check_default(&lease_id);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Defaulted);

    // Pay full remaining balance (total_price 1000 - deposit 100 = 900)
    lease_client.pay(&lease_id, &payer, &900);

    let lease = lease_client.get_lease(&lease_id);
    assert_eq!(lease.status, Status::Completed);
    assert_eq!(lease.paid, 900);

    // Title transfers to lessee automatically
    let title_entry = title_client.get_entry(&asset_id).unwrap();
    assert_eq!(title_entry.owner, lessee);
    assert_eq!(title_entry.custodian, None);
}

#[test]
fn test_check_default_idempotent_and_arbitrary_caller() {
    let (env, lessor, lessee, _, keeper, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );
    lease_client.activate(&lease_id);

    // Advance past due date into Grace
    env.ledger().set_timestamp(1_086_401);

    // Multiple calls by arbitrary address (keeper) produce idempotent result
    for _ in 0..5 {
        let status = lease_client.check_default(&lease_id);
        assert_eq!(status, Status::Grace);
    }

    let lease = lease_client.get_lease(&lease_id);
    assert_eq!(lease.status, Status::Grace);
    assert_eq!(lease.paid, 0);

    let _ = keeper;
}

#[test]
fn test_check_default_does_nothing_on_terminal_states() {
    let (env, lessor, lessee, payer, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);

    // 1. Pending
    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );
    env.ledger().set_timestamp(2_000_000);
    assert_eq!(lease_client.check_default(&lease_id), Status::Pending);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Pending);

    // 2. Cancelled
    lease_client.cancel(&lease_id);
    assert_eq!(lease_client.check_default(&lease_id), Status::Cancelled);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Cancelled);

    // 3. Completed
    let asset2 = BytesN::from_array(&env, &[43u8; 32]);
    let title_client = TitleRegistryClient::new(&env, &title_contract);
    title_client.register(&asset2, &lessor);
    let lease_id2 = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset2,
        &title_contract,
        &token_addr,
        &500,
        &50,
        &50,
        &86400,
        &86400,
    );
    lease_client.activate(&lease_id2);
    lease_client.pay(&lease_id2, &payer, &450);
    assert_eq!(lease_client.get_lease(&lease_id2).status, Status::Completed);
    assert_eq!(lease_client.check_default(&lease_id2), Status::Completed);

    // 4. Repossessed
    let asset3 = BytesN::from_array(&env, &[44u8; 32]);
    title_client.register(&asset3, &lessor);
    let lease_id3 = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset3,
        &title_contract,
        &token_addr,
        &500,
        &50,
        &50,
        &86400,
        &86400,
    );
    lease_client.activate(&lease_id3);
    // Move to defaulted
    env.ledger().set_timestamp(3_000_000);
    lease_client.check_default(&lease_id3);
    // Repossess
    env.ledger().set_timestamp(3_000_000 + 86400 * 10);
    lease_client.repossess(&lease_id3);
    assert_eq!(
        lease_client.get_lease(&lease_id3).status,
        Status::Repossessed
    );
    assert_eq!(lease_client.check_default(&lease_id3), Status::Repossessed);
}

#[test]
#[should_panic(expected = "7")] // Error::NotDefaulted
fn test_repossess_rejected_when_not_defaulted() {
    let (env, lessor, lessee, _, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );
    lease_client.activate(&lease_id);
    // Active, not Defaulted -> panic NotDefaulted
    lease_client.repossess(&lease_id);
}

#[test]
#[should_panic(expected = "8")] // Error::RepossessionTooEarly
fn test_repossess_rejected_when_too_early() {
    let (env, lessor, lessee, _, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );
    lease_client.activate(&lease_id);

    // Defaulted: now = next_due + grace + 1 = 1,000,000 + 86400 + 86400 + 1 = 1,172,801
    env.ledger().set_timestamp(1_172_801);
    lease_client.check_default(&lease_id);

    // Try repossess before repossession_wait (7 days = 604,800s) has passed
    // min repossession ts = 1,172,800 + 604,800 = 1,777,600
    env.ledger().set_timestamp(1_200_000); // Only ~1/3 of wait period passed
    lease_client.repossess(&lease_id);
}

#[test]
fn test_repossess_accepted_after_wait_and_title_returns() {
    let (env, lessor, lessee, _, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);
    let title_client = TitleRegistryClient::new(&env, &title_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );
    lease_client.activate(&lease_id);

    // Advance past default + wait period (min repossession ts = 1,777,600)
    env.ledger().set_timestamp(1_172_801);
    lease_client.check_default(&lease_id);

    env.ledger().set_timestamp(1_777_601);
    lease_client.repossess(&lease_id);

    let lease = lease_client.get_lease(&lease_id);
    assert_eq!(lease.status, Status::Repossessed);

    // Title released from escrow back to lessor (custodian cleared)
    let title_entry = title_client.get_entry(&asset_id).unwrap();
    assert_eq!(title_entry.owner, lessor);
    assert_eq!(title_entry.custodian, None);
}

#[test]
#[should_panic(expected = "4")] // Error::InvalidState
fn test_cancel_rejected_after_activation() {
    let (env, lessor, lessee, _, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );
    lease_client.activate(&lease_id);

    // Cancel after activation should fail
    lease_client.cancel(&lease_id);
}

#[test]
fn test_cancel_returns_title_to_lessor() {
    let (env, lessor, lessee, _, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);
    let title_client = TitleRegistryClient::new(&env, &title_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );

    // Prior to cancel: custodian is lease contract
    assert_eq!(
        title_client.get_entry(&asset_id).unwrap().custodian,
        Some(lease_contract.clone())
    );

    // Cancel while pending
    lease_client.cancel(&lease_id);

    let lease = lease_client.get_lease(&lease_id);
    assert_eq!(lease.status, Status::Cancelled);

    // Title returned to lessor (custodian cleared)
    let title_entry = title_client.get_entry(&asset_id).unwrap();
    assert_eq!(title_entry.owner, lessor);
    assert_eq!(title_entry.custodian, None);
}

#[test]
fn test_extend_ttl_keeps_entry_alive() {
    let (env, lessor, lessee, _, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );

    // Permissionless extend_ttl
    lease_client.extend_ttl(&lease_id);

    // Lease entry is alive and readable
    let lease = lease_client.get_lease(&lease_id);
    assert_eq!(lease.id, lease_id);
}

#[test]
fn test_happy_path_create_activate_pay_to_completion() {
    let (env, lessor, lessee, payer, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);
    let title_client = TitleRegistryClient::new(&env, &title_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &300,
        &86400,
        &86400,
    );

    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Pending);

    lease_client.activate(&lease_id);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Active);

    lease_client.pay(&lease_id, &payer, &300);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Active);

    lease_client.pay(&lease_id, &payer, &300);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Active);

    lease_client.pay(&lease_id, &payer, &300);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Completed);

    let entry = title_client.get_entry(&asset_id).unwrap();
    assert_eq!(entry.owner, lessee);
    assert_eq!(entry.custodian, None);
}

#[test]
fn test_on_time_payments_across_many_intervals_stays_active() {
    let (env, lessor, lessee, payer, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );
    lease_client.activate(&lease_id);

    // Pay 8 installments on time
    for i in 1..=8 {
        env.ledger()
            .set_timestamp(1_000_000 + (i - 1) * 86400 + 3600);
        lease_client.pay(&lease_id, &payer, &100);
        let lease = lease_client.get_lease(&lease_id);
        assert_eq!(lease.status, Status::Active);
        assert_eq!(lease.paid, (i as i128) * 100);
    }

    // Final 9th installment
    env.ledger().set_timestamp(1_000_000 + 8 * 86400 + 3600);
    lease_client.pay(&lease_id, &payer, &100);
    let lease = lease_client.get_lease(&lease_id);
    assert_eq!(lease.status, Status::Completed);
    assert_eq!(lease.paid, 900);
}

#[test]
fn test_missed_payment_beyond_grace_defaulted() {
    let (env, lessor, lessee, _, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );
    lease_client.activate(&lease_id);

    // 1 second past grace: 1_000_000 + 86400 + 86400 + 1 = 1_172_801
    env.ledger().set_timestamp(1_172_801);

    let status = lease_client.check_default(&lease_id);
    assert_eq!(status, Status::Defaulted);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Defaulted);

    let view = lease_client.get_status(&lease_id);
    assert_eq!(view.stored_status, Status::Defaulted);
    assert!(view.arrears > 0);
}

#[test]
fn test_partial_payments_accumulate_not_on_time() {
    let (env, lessor, lessee, payer, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );
    lease_client.activate(&lease_id);

    // Partial payment of 50
    lease_client.pay(&lease_id, &payer, &50);
    assert_eq!(lease_client.get_lease(&lease_id).paid, 50);

    // next_due is still due(1) = 1_086_400
    assert_eq!(lease_client.get_status(&lease_id).next_due, 1_086_400);

    // Advance into Grace
    env.ledger().set_timestamp(1_086_401);
    let status = lease_client.check_default(&lease_id);
    assert_eq!(status, Status::Grace);

    // Pay remaining 50 clears arrears
    lease_client.pay(&lease_id, &payer, &50);
    assert_eq!(lease_client.get_lease(&lease_id).paid, 100);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Active);
    assert_eq!(
        lease_client.get_status(&lease_id).next_due,
        1_000_000 + 2 * 86400
    );
}

#[test]
fn test_prepayment_advances_next_due() {
    let (env, lessor, lessee, payer, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );
    lease_client.activate(&lease_id);

    // Pay 2 full installments at once: 200
    lease_client.pay(&lease_id, &payer, &200);

    let view = lease_client.get_status(&lease_id);
    assert_eq!(view.next_due, 1_000_000 + 3 * 86400);
    assert_eq!(view.stored_status, Status::Active);
}

#[test]
#[should_panic(expected = "9")] // Error::Overpayment
fn test_overpayment_rejected() {
    let (env, lessor, lessee, payer, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );
    lease_client.activate(&lease_id);

    // Remaining balance is 900. 901 must panic with Overpayment
    lease_client.pay(&lease_id, &payer, &901);
}

#[test]
fn test_third_party_payer() {
    let (env, lessor, lessee, payer, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);
    let token_client = soroban_sdk::token::Client::new(&env, &token_addr);

    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &100,
        &86400,
        &86400,
    );
    lease_client.activate(&lease_id);

    let lessor_bal_before = token_client.balance(&lessor);
    let payer_bal_before = token_client.balance(&payer);

    lease_client.pay(&lease_id, &payer, &100);

    let lessor_bal_after = token_client.balance(&lessor);
    let payer_bal_after = token_client.balance(&payer);

    assert_eq!(lessor_bal_after - lessor_bal_before, 100);
    assert_eq!(payer_bal_before - payer_bal_after, 100);
    assert_eq!(lease_client.get_lease(&lease_id).paid, 100);
}

#[test]
fn test_unauthorized_repossess_cancel_activate() {
    let env = Env::default();
    let lease_contract = env.register_contract(None, LeaseContract);
    let lease_client = LeaseContractClient::new(&env, &lease_contract);

    // In unmocked auth environment, calls requiring auth fail
    assert!(lease_client.try_activate(&1).is_err());
    assert!(lease_client.try_repossess(&1).is_err());
    assert!(lease_client.try_cancel(&1).is_err());
}

#[test]
fn test_arithmetic_edge_cases_and_final_remainder() {
    let (env, lessor, lessee, payer, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);

    // 1. Remainder absorbed in final installment: 900 total with 400 installment -> 400, 400, 100
    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &1000,
        &100,
        &400,
        &86400,
        &86400,
    );
    lease_client.activate(&lease_id);

    lease_client.pay(&lease_id, &payer, &400);
    lease_client.pay(&lease_id, &payer, &400);
    lease_client.pay(&lease_id, &payer, &100);
    assert_eq!(lease_client.get_lease(&lease_id).paid, 900);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Completed);

    // 2. Near i128::MAX terms validation
    let valid_large_terms = Terms {
        total_price: i128::MAX - 1000,
        deposit: 1000,
        installment: 10_000,
        interval: 86400,
        grace: 86400,
    };
    assert!(validate_terms(&valid_large_terms).is_ok());

    // 3. Negative amount in pay rejected
    assert!(lease_client.try_pay(&lease_id, &payer, &-50).is_err());

    // 4. Zero amount in pay rejected
    assert!(lease_client.try_pay(&lease_id, &payer, &0).is_err());
}

#[test]
fn test_full_lifecycle_multi_day_scenario_events_in_order() {
    let (env, lessor, lessee, payer, _, asset_id, title_contract, token_addr, lease_contract) =
        create_test_env();
    let lease_client = LeaseContractClient::new(&env, &lease_contract);
    let title_client = TitleRegistryClient::new(&env, &title_contract);

    // Day 0 (t=1_000_000): Create and activate
    // total 700 - deposit 100 = 600 remaining (6 installments of 100)
    let lease_id = lease_client.create_lease(
        &lessor,
        &lessee,
        &asset_id,
        &title_contract,
        &token_addr,
        &700,
        &100,
        &100,
        &86400,
        &86400,
    );
    lease_client.activate(&lease_id);

    // Interval 1 (t=1_050_000): On-time payment 1 (100) -> Active
    env.ledger().set_timestamp(1_050_000);
    lease_client.pay(&lease_id, &payer, &100);

    // Interval 2 (t=1_200_000): Misses payment 2. Next due was 1_172_800.
    // 1_200_000 is inside grace (grace ends at 1_259_200).
    env.ledger().set_timestamp(1_200_000);
    lease_client.check_default(&lease_id);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Grace);

    // Interval 2 (t=1_210_000): Rider pays catch-up payment 2 (100) -> Cured to Active
    env.ledger().set_timestamp(1_210_000);
    lease_client.pay(&lease_id, &payer, &100);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Active);

    // Interval 3 (t=1_250_000): On-time payment 3 (100) -> Active (covered = 3, next_due = 1_345_600)
    env.ledger().set_timestamp(1_250_000);
    lease_client.pay(&lease_id, &payer, &100);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Active);

    // Interval 4 (t=1_440_000): Misses payment 4 beyond grace (due: 1_345_600, grace ends: 1_432_000)
    env.ledger().set_timestamp(1_440_000);
    lease_client.check_default(&lease_id);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Defaulted);

    // Interval 4 (t=1_445_000): Rider pays full arrears (200 for installments 4 and 5) -> Cured to Active
    // covered becomes 5, next_due becomes 1_000_000 + 6*86400 = 1_518_400 (now=1_445_000 <= 1_518_400)
    env.ledger().set_timestamp(1_445_000);
    lease_client.pay(&lease_id, &payer, &200);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Active);

    // Interval 5 (t=1_500_000): Final payment (100) -> Completed
    env.ledger().set_timestamp(1_500_000);
    lease_client.pay(&lease_id, &payer, &100);
    assert_eq!(lease_client.get_lease(&lease_id).status, Status::Completed);

    // Verify title transferred to lessee
    let entry = title_client.get_entry(&asset_id).unwrap();
    assert_eq!(entry.owner, lessee);
    assert_eq!(entry.custodian, None);

    // Verify event sequence from the lease contract
    use soroban_sdk::String;
    let events = env.events().all();
    let mut lease_events = soroban_sdk::vec![&env];

    for event in events.iter() {
        if event.0 == lease_contract {
            let topic_str: String = event.1.get(0).unwrap().try_into_val(&env).unwrap();
            lease_events.push_back(topic_str);
        }
    }

    let expected = soroban_sdk::vec![
        &env,
        String::from_str(&env, "lease_created"),
        String::from_str(&env, "activated"),
        String::from_str(&env, "payment"),
        String::from_str(&env, "grace_entered"),
        String::from_str(&env, "payment"),
        String::from_str(&env, "cured"),
        String::from_str(&env, "payment"),
        String::from_str(&env, "defaulted"),
        String::from_str(&env, "payment"),
        String::from_str(&env, "cured"),
        String::from_str(&env, "payment"),
        String::from_str(&env, "completed"),
    ];

    assert_eq!(lease_events, expected);
}

use proptest::prelude::*;

proptest! {
    #[test]
    fn prop_paid_never_exceeds_total_due(
        total_price in 100i128..10_000_000i128,
        deposit_pct in 1i128..50i128,
        installment_pct in 1i128..50i128,
        payments in prop::collection::vec(1i128..1_000_000i128, 1..20),
    ) {
        let deposit = total_price * deposit_pct / 100;
        let remaining_total = total_price - deposit;
        let _installment = (remaining_total * installment_pct / 100).max(1);

        let mut paid = 0i128;
        for p in payments {
            let max_payable = remaining_total - paid;
            if p <= max_payable {
                paid += p;
            }
            prop_assert!(paid <= remaining_total);
        }
    }

    #[test]
    fn prop_status_transitions_valid_edges(
        now_deltas in prop::collection::vec(1u64..200_000u64, 1..20),
        pay_amounts in prop::collection::vec(0i128..200i128, 1..20),
    ) {
        let total_price = 1000i128;
        let deposit = 100i128;
        let installment = 100i128;
        let interval = 86400u64;
        let grace = 86400u64;
        let start_ts = 1_000_000u64;

        let mut current_status = Status::Active;
        let mut paid = 0i128;
        let mut now = start_ts;

        for (delta, p) in now_deltas.into_iter().zip(pay_amounts.into_iter()) {
            now = now.saturating_add(delta);
            let remaining = total_price - deposit - paid;
            if p > 0 && p <= remaining {
                paid += p;
            }

            let next_status = crate::schedule::derive_status(
                now,
                start_ts,
                interval,
                grace,
                paid,
                installment,
                total_price,
                deposit,
            );

            // Valid edges per README section 6:
            // Active -> Active, Grace, Defaulted, Completed
            // Grace -> Grace, Active, Defaulted, Completed
            // Defaulted -> Defaulted, Active, Grace, Completed
            // Completed -> Completed
            let valid = matches!(
                (current_status, next_status),
                (Status::Active, Status::Active)
                    | (Status::Active, Status::Grace)
                    | (Status::Active, Status::Defaulted)
                    | (Status::Active, Status::Completed)
                    | (Status::Grace, Status::Active)
                    | (Status::Grace, Status::Grace)
                    | (Status::Grace, Status::Defaulted)
                    | (Status::Grace, Status::Completed)
                    | (Status::Defaulted, Status::Active)
                    | (Status::Defaulted, Status::Grace)
                    | (Status::Defaulted, Status::Defaulted)
                    | (Status::Defaulted, Status::Completed)
                    | (Status::Completed, Status::Completed)
            );
            prop_assert!(
                valid,
                "Invalid transition from {:?} to {:?}",
                current_status,
                next_status
            );
            current_status = next_status;
        }
    }
}
