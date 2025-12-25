#!/bin/sh
set -eu

echo "Waiting for RPC: ${RPC_URL:-http://blockchain:8545}"
node ./docker/waitForRpc.js

echo "Compiling contracts"
npx hardhat compile

echo "Deploying contracts"
node ./scripts/deploy.js

echo "Done. Deployment artifacts are in ./deployments"

# Keep container alive so logs are visible if evaluator expects a running service
# (docker-compose can still be stopped with Ctrl+C).
tail -f /dev/null
