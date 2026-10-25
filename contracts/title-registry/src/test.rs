//! Unit tests for the Mallaka title registry types and errors.

use soroban_sdk::BytesN;

use crate::errors::Error;

#[test]
fn test_error_variants() {
    assert_eq!(Error::NotFound as u32, 1);
    assert_eq!(Error::Unauthorized as u32, 2);
    assert_eq!(Error::AlreadyRegistered as u32, 3);
    assert_eq!(Error::NotOwner as u32, 4);
    assert_eq!(Error::InvalidState as u32, 5);
}

#[test]
fn test_asset_id_creation() {
    let env = soroban_sdk::Env::default();
    let asset_id = BytesN::from_array(&env, &[1u8; 32]);
    assert_eq!(asset_id.len(), 32);
}
