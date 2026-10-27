#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Building Soroban WASM Contracts ==="
cd "$ROOT_DIR/contracts"
stellar contract build --package title-registry
stellar contract build --package lease

TITLE_WASM="$ROOT_DIR/contracts/target/wasm32v1-none/release/title_registry.wasm"
LEASE_WASM="$ROOT_DIR/contracts/target/wasm32v1-none/release/lease.wasm"

if [[ ! -f "$TITLE_WASM" || ! -f "$LEASE_WASM" ]]; then
    echo "Error: WASM artifacts not found at $TITLE_WASM or $LEASE_WASM" >&2
    exit 1
fi

echo "=== Ensuring Testnet Identities (Funded) ==="
IDENTITIES=("lessor" "rider" "keeper" "sponsor")
for ID in "${IDENTITIES[@]}"; do
    if ! stellar keys address "$ID" >/dev/null 2>&1; then
        echo "Generating and funding testnet identity: $ID..."
        stellar keys generate "$ID" --network testnet --fund
    else
        echo "Identity '$ID' ready: $(stellar keys address "$ID")"
    fi
done

LESSOR_ADDR="$(stellar keys address lessor)"
RIDER_ADDR="$(stellar keys address rider)"
KEEPER_ADDR="$(stellar keys address keeper)"
SPONSOR_ADDR="$(stellar keys address sponsor)"

echo "=== Deploying Title Registry Contract to Testnet ==="
TITLE_REGISTRY_ID=$(stellar contract deploy \
  --wasm "$TITLE_WASM" \
  --source lessor \
  --network testnet \
  --alias title_registry)

echo "Title Registry deployed: $TITLE_REGISTRY_ID"

echo "Initializing Title Registry..."
stellar contract invoke \
  --id "$TITLE_REGISTRY_ID" \
  --source lessor \
  --network testnet -- \
  initialize --admin "$LESSOR_ADDR" || true

echo "=== Deploying Lease Contract to Testnet ==="
LEASE_ID=$(stellar contract deploy \
  --wasm "$LEASE_WASM" \
  --source lessor \
  --network testnet \
  --alias lease)

echo "Lease Contract deployed: $LEASE_ID"

echo "Initializing Lease Contract..."
stellar contract invoke \
  --id "$LEASE_ID" \
  --source lessor \
  --network testnet -- \
  initialize --admin "$LESSOR_ADDR" || true

DEPLOYED_FILE="$ROOT_DIR/.deployed.testnet.json"
cat > "$DEPLOYED_FILE" <<EOF
{
  "network": "testnet",
  "titleRegistryContractId": "$TITLE_REGISTRY_ID",
  "leaseContractId": "$LEASE_ID",
  "lessorAddress": "$LESSOR_ADDR",
  "riderAddress": "$RIDER_ADDR",
  "keeperAddress": "$KEEPER_ADDR",
  "sponsorAddress": "$SPONSOR_ADDR"
}
EOF

echo ""
echo "=== Deployment Successfully Completed ==="
echo "Config written to: $DEPLOYED_FILE"
echo ""
echo "Matching .env lines:"
echo "STELLAR_NETWORK=testnet"
echo "SOROBAN_RPC_URL=https://soroban-testnet.stellar.org"
echo "LEASE_CONTRACT_ID=$LEASE_ID"
echo "TITLE_REGISTRY_CONTRACT_ID=$TITLE_REGISTRY_ID"
echo "SPONSOR_PUBLIC_KEY=$SPONSOR_ADDR"
