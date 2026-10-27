# Contract Test Matrix

This matrix maps every row from [README Section 17 (Contract Tests)](../README.md#contract-tests-cargo-test) to its named Rust test in `contracts/lease/src/test.rs`.

## README Section 17 Requirements Matrix

| # | README Scenario | Expected Behavior | Named Rust Test | Status |
|---|-----------------|-------------------|-----------------|:------:|
| 1 | Happy path: create, activate, pay to completion | Title transfers on final payment | `test_happy_path_create_activate_pay_to_completion` | [x] |
| 2 | On-time payments across many intervals | Stays `Active` | `test_on_time_payments_across_many_intervals_stays_active` | [x] |
| 3 | Missed payment inside grace | `Active` to `Grace` to `Active` after catch-up | `test_active_to_grace_to_active_catch_up` | [x] |
| 4 | Missed payment beyond grace | `Defaulted`, `defaulted` event emitted | `test_missed_payment_beyond_grace_defaulted` | [x] |
| 5 | Cure after default | Returns to `Active`, `cured` event emitted | `test_active_to_grace_to_defaulted_to_active_cure` | [x] |
| 6 | Partial payments | Accumulate, do not count as on time until full | `test_partial_payments_accumulate_not_on_time` | [x] |
| 7 | Prepayment | `next_due` advances by multiple intervals | `test_prepayment_advances_next_due` | [x] |
| 8 | Overpayment | Rejected with `Overpayment` | `test_overpayment_rejected` | [x] |
| 9 | Third-party payer | Funds reach the lessor, balance updates | `test_third_party_payer` | [x] |
| 10 | Unauthorized `repossess`, `cancel`, `activate` | Rejected with auth error | `test_unauthorized_repossess_cancel_activate` | [x] |
| 11 | `repossess` before minimum default period | Rejected with `RepossessionTooEarly` | `test_repossess_rejected_when_too_early` | [x] |
| 12 | `check_default` called by anyone, repeatedly | Idempotent, no state corruption | `test_check_default_idempotent_and_arbitrary_caller` | [x] |
| 13 | TTL extension | Entry survives past default TTL | `test_extend_ttl_keeps_entry_alive` | [x] |
| 14 | Arithmetic edge cases | No overflow, final installment absorbs remainder | `test_arithmetic_edge_cases_and_final_remainder` | [x] |

## Lifecycle Scenario Tests

| Scenario | Description | Named Rust Test | Status |
|----------|-------------|-----------------|:------:|
| Complete Multi-Day Lifecycle | Full multi-day lifecycle across many intervals: on-time payment, grace entry, catch-up cure, default entry, full arrears cure, and completion with title transfer. Asserts all emitted events in strict chronological order. | `test_full_lifecycle_multi_day_scenario_events_in_order` | [x] |

## Property-Based Invariant Tests (proptest)

| Invariant | Description | Named Rust Test | Status |
|-----------|-------------|-----------------|:------:|
| Paid Cap Invariant | `paid <= total_price - deposit` is never violated under arbitrary sequence of payments. | `prop_paid_never_exceeds_total_due` | [x] |
| State Transition Graph | Status transitions strictly follow edges in README section 6 state machine. | `prop_status_transitions_valid_edges` | [x] |

> **Note on Broader Property Coverage:**
> As specified in README Section 23 ("Good first issues"), broader property-based test fuzzing across arbitrary payment sequences and milestone schedules is left open for community contributors.
