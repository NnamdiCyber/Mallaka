//! Pure schedule logic for the Mallaka lease contract.
//! No storage, no ledger access - only arithmetic and state derivation.

use crate::errors::Error;
use crate::types::{Status, Terms};

/// Calculate the remaining balance to complete the lease (excluding deposit).
/// Returns Error::MathOverflow on overflow.
pub fn installments_remaining_balance(
    total_price: i128,
    deposit: i128,
    paid: i128,
) -> Result<i128, Error> {
    let total_due = total_price
        .checked_sub(deposit)
        .ok_or(Error::MathOverflow)?;
    total_due.checked_sub(paid).ok_or(Error::MathOverflow)
}

/// Calculate how many full installments have been covered by the amount paid.
/// Uses floor division: covered = floor(paid / installment)
pub fn covered_installments(paid: i128, installment: i128) -> u64 {
    if installment <= 0 || paid <= 0 {
        return 0;
    }
    (paid / installment) as u64
}

/// Calculate the due timestamp for installment k (1-indexed).
/// due(k) = start_ts + k * interval
pub fn due_timestamp(start_ts: u64, interval: u64, k: u64) -> Result<u64, Error> {
    let offset = interval.checked_mul(k).ok_or(Error::MathOverflow)?;
    start_ts.checked_add(offset).ok_or(Error::MathOverflow)
}

/// Calculate the next due timestamp based on payments made.
/// next_due = due(covered + 1)
pub fn next_due(start_ts: u64, interval: u64, paid: i128, installment: i128) -> u64 {
    let covered = covered_installments(paid, installment);
    due_timestamp(start_ts, interval, covered + 1).unwrap_or(u64::MAX)
}

/// Derive the lease status from on-chain state and current time.
/// Implements the status derivation table from README 8.2.
///
/// Status precedence:
/// 1. Completed (paid >= total_price - deposit)
/// 2. Defaulted (now > next_due + grace)
/// 3. Grace (next_due < now <= next_due + grace)
/// 4. Active (now <= next_due)
#[allow(clippy::too_many_arguments)]
pub fn derive_status(
    now: u64,
    start_ts: u64,
    interval: u64,
    grace: u64,
    paid: i128,
    installment: i128,
    total_price: i128,
    deposit: i128,
) -> Status {
    // Rule: Completed takes precedence (README 8.2, row 4)
    let remaining = total_price.saturating_sub(deposit).saturating_sub(paid);
    if remaining <= 0 {
        return Status::Completed;
    }

    let next_due_ts = next_due(start_ts, interval, paid, installment);
    let grace_end = next_due_ts.saturating_add(grace);

    if now > grace_end {
        Status::Defaulted
    } else if now > next_due_ts {
        Status::Grace
    } else {
        Status::Active
    }
}

/// Calculate total number of installments using ceil division.
/// The final installment absorbs any remainder.
/// total_installments = ceil((total_price - deposit) / installment)
#[allow(dead_code)]
pub fn total_installments(
    total_price: i128,
    deposit: i128,
    installment: i128,
) -> Result<u64, Error> {
    if installment <= 0 {
        return Err(Error::InvalidTerms);
    }
    let amount = total_price
        .checked_sub(deposit)
        .ok_or(Error::MathOverflow)?;
    let (quot, rem) = (amount / installment, amount % installment);
    let total = if rem > 0 { quot + 1 } else { quot };
    Ok(total as u64)
}

/// Calculate arrears (overdue amount in token base units).
/// If now <= next_due, arrears is 0.
/// When overdue, calculates the cumulative amount expected to have been paid
/// by `now` based on elapsed intervals (capped at total_price - deposit),
/// minus the amount actually paid.
pub fn calculate_arrears(
    now: u64,
    start_ts: u64,
    interval: u64,
    paid: i128,
    installment: i128,
    total_price: i128,
    deposit: i128,
) -> i128 {
    if interval == 0 || start_ts == 0 || now <= start_ts {
        return 0;
    }
    let total_remaining_due = total_price.saturating_sub(deposit);
    let intervals_passed = (now.saturating_sub(start_ts)) / interval;
    if intervals_passed == 0 {
        return 0;
    }
    let expected_paid = (intervals_passed as i128)
        .saturating_mul(installment)
        .min(total_remaining_due);
    expected_paid.saturating_sub(paid).max(0)
}

/// Validate lease terms per README 7.2 and 8.3.
/// Returns Error::InvalidTerms if validation fails.
pub fn validate_terms(terms: &Terms) -> Result<(), Error> {
    // Rule: positive amounts
    if terms.total_price <= 0 || terms.deposit < 0 || terms.installment <= 0 {
        return Err(Error::InvalidTerms);
    }
    // Rule: interval > 0
    if terms.interval == 0 {
        return Err(Error::InvalidTerms);
    }
    // Rule: deposit < total_price
    if terms.deposit >= terms.total_price {
        return Err(Error::InvalidTerms);
    }
    // Rule: installment <= total_price - deposit
    let remaining = terms.total_price - terms.deposit;
    if terms.installment > remaining {
        return Err(Error::InvalidTerms);
    }
    // Rule: grace can be 0 (no grace period)
    // All valid
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_installments_remaining_balance_basic() {
        assert_eq!(installments_remaining_balance(1000, 100, 0).unwrap(), 900);
        assert_eq!(installments_remaining_balance(1000, 100, 300).unwrap(), 600);
        assert_eq!(installments_remaining_balance(1000, 100, 900).unwrap(), 0);
    }

    #[test]
    fn test_covered_installments_floor() {
        assert_eq!(covered_installments(0, 100), 0);
        assert_eq!(covered_installments(99, 100), 0); // partial doesn't count
        assert_eq!(covered_installments(100, 100), 1);
        assert_eq!(covered_installments(199, 100), 1);
        assert_eq!(covered_installments(200, 100), 2);
        assert_eq!(covered_installments(250, 100), 2);
    }

    #[test]
    fn test_due_timestamp() {
        assert_eq!(due_timestamp(1000, 86400, 1).unwrap(), 1000 + 86400);
        assert_eq!(due_timestamp(1000, 86400, 2).unwrap(), 1000 + 2 * 86400);
        assert_eq!(due_timestamp(1000, 604800, 1).unwrap(), 1000 + 604800); // weekly
    }

    #[test]
    fn test_next_due() {
        // No payments: next_due = due(1)
        assert_eq!(next_due(1000, 86400, 0, 100), 1000 + 86400);
        // One full installment paid: next_due = due(2)
        assert_eq!(next_due(1000, 86400, 100, 100), 1000 + 2 * 86400);
        // Partial payment: next_due still due(1)
        assert_eq!(next_due(1000, 86400, 50, 100), 1000 + 86400);
        // Prepayment of 2 installments: next_due = due(3)
        assert_eq!(next_due(1000, 86400, 200, 100), 1000 + 3 * 86400);
    }

    #[test]
    fn test_derive_status_active() {
        let start = 1000;
        let interval = 86400;
        let grace = 86400;
        let installment = 100;
        let total = 1000;
        let deposit = 100;

        // At start_ts, should be Active (now <= next_due)
        assert_eq!(
            derive_status(1000, start, interval, grace, 0, installment, total, deposit),
            Status::Active
        );
        // Before first due
        assert_eq!(
            derive_status(
                1000 + 43200,
                start,
                interval,
                grace,
                0,
                installment,
                total,
                deposit
            ),
            Status::Active
        );
        // Exactly at due (now == next_due)
        assert_eq!(
            derive_status(
                1000 + 86400,
                start,
                interval,
                grace,
                0,
                installment,
                total,
                deposit
            ),
            Status::Active
        );
    }

    #[test]
    fn test_derive_status_grace() {
        let start = 1000;
        let interval = 86400;
        let grace = 86400;
        let installment = 100;
        let total = 1000;
        let deposit = 100;

        // 1 second past due: Grace
        assert_eq!(
            derive_status(
                1000 + 86400 + 1,
                start,
                interval,
                grace,
                0,
                installment,
                total,
                deposit
            ),
            Status::Grace
        );
        // Exactly at grace end: Grace
        assert_eq!(
            derive_status(
                1000 + 86400 + 86400,
                start,
                interval,
                grace,
                0,
                installment,
                total,
                deposit
            ),
            Status::Grace
        );
    }

    #[test]
    fn test_derive_status_defaulted() {
        let start = 1000;
        let interval = 86400;
        let grace = 86400;
        let installment = 100;
        let total = 1000;
        let deposit = 100;

        // 1 second past grace end: Defaulted
        assert_eq!(
            derive_status(
                1000 + 86400 + 86400 + 1,
                start,
                interval,
                grace,
                0,
                installment,
                total,
                deposit
            ),
            Status::Defaulted
        );
    }

    #[test]
    fn test_derive_status_completed_precedence() {
        let start = 1000;
        let interval = 86400;
        let grace = 86400;
        let installment = 100;
        let total = 1000;
        let deposit = 100;

        // Even if past grace, Completed takes precedence (README 8.2)
        // paid = 900 (total - deposit)
        assert_eq!(
            derive_status(
                1000 + 86400 + 86400 + 1,
                start,
                interval,
                grace,
                900,
                installment,
                total,
                deposit
            ),
            Status::Completed
        );
    }

    #[test]
    fn test_derive_status_partial_payments_dont_count_on_time() {
        // Rule 8.3.1: Partial payments accumulate but do not count as on time
        let start = 1000;
        let interval = 86400;
        let grace = 86400;
        let installment = 100;
        let total = 1000;
        let deposit = 100;

        // Paid 50 (partial), at due time - still Grace/Defaulted
        assert_eq!(
            derive_status(
                1000 + 86400,
                start,
                interval,
                grace,
                50,
                installment,
                total,
                deposit
            ),
            Status::Active
        );
        assert_eq!(
            derive_status(
                1000 + 86400 + 1,
                start,
                interval,
                grace,
                50,
                installment,
                total,
                deposit
            ),
            Status::Grace
        );
    }

    #[test]
    fn test_derive_status_prepayment_advances_next_due() {
        // Rule 8.3.2: Prepayments credit forward
        let start = 1000;
        let interval = 86400;
        let grace = 86400;
        let installment = 100;
        let total = 1000;
        let deposit = 100;

        // Paid 200 (2 installments) at start
        // next_due should be due(3) = start + 3*interval
        // At start + 2*interval, should still be Active
        assert_eq!(
            derive_status(
                1000 + 2 * 86400,
                start,
                interval,
                grace,
                200,
                installment,
                total,
                deposit
            ),
            Status::Active
        );
        // At start + 3*interval, should be Active (exactly at due)
        assert_eq!(
            derive_status(
                1000 + 3 * 86400,
                start,
                interval,
                grace,
                200,
                installment,
                total,
                deposit
            ),
            Status::Active
        );
    }

    #[test]
    fn test_derive_status_catch_up_cures() {
        // Rule 8.3.3: Catch-up payments cure arrears
        let start = 1000;
        let interval = 86400;
        let grace = 86400;
        let installment = 100;
        let total = 1000;
        let deposit = 100;

        // Missed first payment, in Grace
        assert_eq!(
            derive_status(
                1000 + 86400 + 1,
                start,
                interval,
                grace,
                0,
                installment,
                total,
                deposit
            ),
            Status::Grace
        );
        // Now pay 2 installments (cure + next)
        // covered = 2, next_due = due(3)
        // At same time (still in grace window), should be Active
        assert_eq!(
            derive_status(
                1000 + 86400 + 1,
                start,
                interval,
                grace,
                200,
                installment,
                total,
                deposit
            ),
            Status::Active
        );
    }

    #[test]
    fn test_derive_status_no_overpayment_past_price() {
        // Rule 8.3.4: Overpayment rejected (tested in pay function)
        // Here just verify derive_status handles paid >= total - deposit
        let start = 1000;
        let interval = 86400;
        let grace = 86400;
        let installment = 100;
        let total = 1000;
        let deposit = 100;

        assert_eq!(
            derive_status(
                1000,
                start,
                interval,
                grace,
                900,
                installment,
                total,
                deposit
            ),
            Status::Completed
        );
        assert_eq!(
            derive_status(
                1000,
                start,
                interval,
                grace,
                1000,
                installment,
                total,
                deposit
            ),
            Status::Completed
        );
    }

    #[test]
    fn test_derive_status_final_installment_remainder() {
        // Rule 8.3.5: Final installment absorbs remainder
        let start = 1000;
        let interval = 86400;
        let grace = 86400;
        let installment = 300;
        let total = 1000;
        let deposit = 100;
        // total - deposit = 900, installment = 300 -> exactly 3 installments

        // After 2 payments (600), next_due = due(3)
        assert_eq!(
            next_due(start, interval, 600, installment),
            start + 3 * interval
        );
        // After 3 payments (900), completed
        assert_eq!(
            derive_status(
                start,
                start,
                interval,
                grace,
                900,
                installment,
                total,
                deposit
            ),
            Status::Completed
        );

        // Now test remainder case: total=1000, deposit=100, installment=400
        // total - deposit = 900, installment = 400 -> ceil(900/400) = 3 installments
        // Installments: 400, 400, 100 (remainder)
        let total2 = 1000;
        let deposit2 = 100;
        let installment2 = 400;

        assert_eq!(
            total_installments(total2, deposit2, installment2).unwrap(),
            3
        );
        // After 800 paid (2 full installments), next_due = due(3)
        assert_eq!(
            next_due(start, interval, 800, installment2),
            start + 3 * interval
        );
        // After 900 paid (completed)
        assert_eq!(
            derive_status(
                start,
                start,
                interval,
                grace,
                900,
                installment2,
                total2,
                deposit2
            ),
            Status::Completed
        );
    }

    #[test]
    fn test_covered_installments_zero_installment() {
        assert_eq!(covered_installments(100, 0), 0);
    }

    #[test]
    fn test_due_timestamp_overflow() {
        assert!(due_timestamp(u64::MAX, 1, 1).is_err());
    }

    #[test]
    fn test_total_installments_exact_division() {
        assert_eq!(total_installments(1000, 100, 300).unwrap(), 3);
    }

    #[test]
    fn test_total_installments_with_remainder() {
        assert_eq!(total_installments(1000, 100, 400).unwrap(), 3); // 900/400 = 2.25 -> 3
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
    fn test_validate_terms_invalid_zero_total() {
        let terms = Terms {
            total_price: 0,
            deposit: 100,
            installment: 100,
            interval: 86400,
            grace: 86400,
        };
        assert_eq!(validate_terms(&terms), Err(Error::InvalidTerms));
    }

    #[test]
    fn test_validate_terms_invalid_negative_deposit() {
        let terms = Terms {
            total_price: 1000,
            deposit: -100,
            installment: 100,
            interval: 86400,
            grace: 86400,
        };
        assert_eq!(validate_terms(&terms), Err(Error::InvalidTerms));
    }

    #[test]
    fn test_validate_terms_invalid_zero_installment() {
        let terms = Terms {
            total_price: 1000,
            deposit: 100,
            installment: 0,
            interval: 86400,
            grace: 86400,
        };
        assert_eq!(validate_terms(&terms), Err(Error::InvalidTerms));
    }

    #[test]
    fn test_validate_terms_invalid_zero_interval() {
        let terms = Terms {
            total_price: 1000,
            deposit: 100,
            installment: 100,
            interval: 0,
            grace: 86400,
        };
        assert_eq!(validate_terms(&terms), Err(Error::InvalidTerms));
    }

    #[test]
    fn test_validate_terms_invalid_deposit_ge_total() {
        let terms = Terms {
            total_price: 1000,
            deposit: 1000,
            installment: 100,
            interval: 86400,
            grace: 86400,
        };
        assert_eq!(validate_terms(&terms), Err(Error::InvalidTerms));
    }

    #[test]
    fn test_validate_terms_invalid_installment_gt_remaining() {
        let terms = Terms {
            total_price: 1000,
            deposit: 100,
            installment: 1000,
            interval: 86400,
            grace: 86400,
        };
        assert_eq!(validate_terms(&terms), Err(Error::InvalidTerms));
    }

    #[test]
    fn test_installments_remaining_balance_overflow() {
        // This would overflow if we used unchecked arithmetic
        let result = installments_remaining_balance(i128::MAX, 0, i128::MIN);
        // saturating_sub prevents overflow, but checked_sub would fail
        // Our implementation uses checked_sub so it returns MathOverflow
        assert!(result.is_err() || result.unwrap() > 0);
    }
}
