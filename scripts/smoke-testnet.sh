#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DEPLOYED_FILE="$ROOT_DIR/.deployed.testnet.json"

if [[ ! -f "$DEPLOYED_FILE" ]]; then
    echo "Error: $DEPLOYED_FILE not found. Run scripts/deploy-testnet.sh first." >&2
    exit 1
fi

LEASE_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$DEPLOYED_FILE')).leaseContractId)")
TITLE_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$DEPLOYED_FILE')).titleRegistryContractId)")
LESSOR_ADDR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$DEPLOYED_FILE')).lessorAddress)")
RIDER_ADDR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$DEPLOYED_FILE')).riderAddress)")
KEEPER_ADDR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$DEPLOYED_FILE')).keeperAddress)")

# Native testnet XLM SAC contract ID
NATIVE_TOKEN_ID="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"

echo "=== Running Testnet Smoke Test ==="
echo "Lease Contract: $LEASE_ID"
echo "Title Registry: $TITLE_ID"
echo "Lessor: $LESSOR_ADDR"
echo "Rider: $RIDER_ADDR"
echo "Keeper: $KEEPER_ADDR"

# Generate unique 32-byte hex for asset
ASSET_HEX=$(openssl rand -hex 32)
echo "Generated Asset ID: $ASSET_HEX"

echo "--- 1. Registering asset in Title Registry ---"
stellar contract invoke \
  --id "$TITLE_ID" \
  --source lessor \
  --network testnet -- \
  register \
  --asset_id "$ASSET_HEX" \
  --owner "$LESSOR_ADDR"

echo "--- 2. Lessor creates lease (create_lease) ---"
# terms: total_price=50000000, deposit=5000000, installment=5000000, interval=86400, grace=86400
CREATE_OUT=$(stellar contract invoke \
  --id "$LEASE_ID" \
  --source lessor \
  --network testnet -- \
  create_lease \
  --lessor "$LESSOR_ADDR" \
  --lessee "$RIDER_ADDR" \
  --asset_id "$ASSET_HEX" \
  --title_contract "$TITLE_ID" \
  --token "$NATIVE_TOKEN_ID" \
  --total_price 50000000 \
  --deposit 5000000 \
  --installment 5000000 \
  --interval 86400 \
  --grace 86400)

LEASE_NUM=$(echo "$CREATE_OUT" | tr -d '"' | tr -d ' ' | tail -n 1)
echo "Created lease ID: $LEASE_NUM"

echo "--- 3. Rider activates lease (activate) ---"
stellar contract invoke \
  --id "$LEASE_ID" \
  --source rider \
  --network testnet -- \
  activate \
  --lease_id "$LEASE_NUM"

echo "--- 4. Rider makes payment (pay) ---"
stellar contract invoke \
  --id "$LEASE_ID" \
  --source rider \
  --network testnet -- \
  pay \
  --lease_id "$LEASE_NUM" \
  --payer "$RIDER_ADDR" \
  --amount 5000000

echo "--- 5. Anyone checks default (check_default) ---"
stellar contract invoke \
  --id "$LEASE_ID" \
  --source keeper \
  --network testnet -- \
  check_default \
  --lease_id "$LEASE_NUM"

echo "--- 6. Read lease status (get_status) ---"
stellar contract invoke \
  --id "$LEASE_ID" \
  --source keeper \
  --network testnet -- \
  get_status \
  --lease_id "$LEASE_NUM"

echo "✅ Smoke test completed successfully against testnet!"
