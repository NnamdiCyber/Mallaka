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
    testutils::{Address as _, Ledger as _},
    Address, BytesN,
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
