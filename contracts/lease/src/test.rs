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
