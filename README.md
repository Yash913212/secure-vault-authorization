# Secure Vault Authorization

Two small contracts, one clear responsibility each:

- `SecureVault.sol` holds ETH and executes withdrawals.
- `AuthorizationManager.sol` verifies **EIP-712** signed withdrawal approvals and permanently consumes them (single-use).

The key design choice is deliberate: **the vault never recovers signatures itself**. It delegates that work to the authorization manager.

## What this repo demonstrates

- A clean **separation of concerns** (fund custody vs. signature/authorization validation).
- **Off-chain approvals** (signed messages) with **on-chain enforcement**.
- Strong replay protection by consuming each authorization exactly once.

## How it works (in plain English)

1. Anyone can deposit ETH into `SecureVault` (just send ETH to the contract address).
2. Off-chain, the `authorizedSigner` signs a typed “withdrawal authorization” (EIP-712).
3. Anyone can submit that signed authorization on-chain by calling `SecureVault.withdraw(...)`.
4. The vault asks `AuthorizationManager.verifyAuthorization(...)` whether the withdrawal is allowed.
5. The manager validates:
   - the caller really is the configured vault
   - the authorization is meant for *this* vault instance
   - the signature is valid on *this* chain (domain includes `chainId`)
   - the authorization hasn’t been used before (replay protection)
6. If all checks pass, the vault updates its accounting and transfers ETH.

## Security properties (what’s protected)

- **Single-use approvals:** `AuthorizationManager` stores `consumed[authorizationId]` and marks a signed approval as used on success.
- **Scoped permissions:** signed data includes `(vault, recipient, amount, nonce)`.
- **Chain-bound signatures:** the EIP-712 domain binds to `(chainId, verifyingContract = AuthorizationManager)`.
- **Safer accounting:** `SecureVault.accountedBalance` is decremented **before** the ETH transfer.
- **Vault-only consumption:** EOAs can’t successfully call `verifyAuthorization` directly.
- **One-time initialization:** `AuthorizationManager.setVault(...)` can only be called once.

## What exactly gets signed (EIP-712)

### Domain

- `name`: `SecureVaultAuthorization`
- `version`: `1`
- `chainId`: current chain id
- `verifyingContract`: `AuthorizationManager` address

### Type

`WithdrawalAuthorization(address vault,address recipient,uint256 amount,bytes32 nonce)`

This binds permission to:

- a specific vault instance (`vault`)
- a specific network (`chainId`)
- a specific recipient (`recipient`)
- a specific amount (`amount`)
- a one-time uniqueness value (`nonce`)

## Quickstart (Docker)

You’ll get a local chain (Anvil) plus an auto-deployer.

**Requirements:** Docker Desktop + Docker Compose.

1. Start everything:

```bash
docker compose up --build
```

2. Wait for the deployer to finish. You should see a “Deployed:” JSON blob and then:

> `Wrote deployment artifact: /app/deployments/deployment-31337.json`

3. On your host machine, the artifact will be available at:

- `./deployments/deployment-31337.json`

RPC endpoint from the host:

- `http://127.0.0.1:8545`

## Run tests (recommended)

From the host machine:

```bash
npm install
npm test
```

## Manual interaction notes

- Deposit by sending ETH directly to the deployed `SecureVault` address.
- Off-chain, generate the EIP-712 signature using the **authorized signer** private key.
- On-chain, call:
  - `withdraw(recipient, amount, nonce, signature)`

The included system tests (`tests/system.spec.js`) cover:

- a successful withdrawal
- replay prevention
- rejection of mismatched parameters
- rejection of direct manager calls by EOAs

## Skills used

- Solidity smart contracts (0.8.x)
- EIP-712 typed data signing & verification
- OpenZeppelin crypto/security primitives (EIP712, ECDSA, ReentrancyGuard)
- Hardhat + ethers.js (deployment + tests)
- Docker / Docker Compose (repeatable local chain + deploy)

## Where to look

- `contracts/SecureVault.sol`
- `contracts/AuthorizationManager.sol`
- `scripts/deploy.js`
- `tests/system.spec.js`
- `docker-compose.yml`
- `docker/Dockerfile`, `docker/entrypoint.sh`

## Known limitations / easy extensions

- This is a minimal reference implementation (a single `authorizedSigner`).
- Authorization cancellation/expiry windows are not implemented.
  - Easy upgrade: add a `deadline` field to the typed data and enforce it in `AuthorizationManager`.
