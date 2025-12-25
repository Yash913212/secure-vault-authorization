# Secure Vault Authorization (Vault + AuthorizationManager)

This repository implements a **two-contract** architecture where:

- `SecureVault.sol` **holds and transfers funds**.
- `AuthorizationManager.sol` **verifies and consumes** off-chain generated withdrawal permissions.

The vault **does not** verify signatures. It delegates all permission validation to the authorization manager.

## Architecture & flow

1. Anyone deposits native currency into `SecureVault` (plain ETH transfers).
2. Off-chain coordination produces a withdrawal authorization (EIP-712 typed data) signed by `authorizedSigner`.
3. Anyone can submit the authorization to the vault via `SecureVault.withdraw(...)`.
4. The vault calls `AuthorizationManager.verifyAuthorization(...)`.
5. The manager verifies:
   - caller is the configured vault
   - authorization is scoped to this **vault instance**
   - signature is valid for this **network** (via EIP-712 domain `chainId`)
   - authorization is **unused** (replay protection)
6. On success, the vault updates accounting and transfers ETH.

## Security properties / invariants

- **Single-use authorizations**: `AuthorizationManager` stores `consumed[authorizationId]` and consumes on success.
- **Tight scoping**: signed data includes `(vault, recipient, amount, nonce)` and EIP-712 domain binds to `(chainId, verifyingContract=AuthorizationManager)`.
- **Exactly-once accounting**: `SecureVault.accountedBalance` is decremented **before** value transfer.
- **Vault-only consumption**: EOAs cannot call `verifyAuthorization` successfully.
- **One-time initialization**: `AuthorizationManager.setVault(...)` can be called only once.

## Authorization format (EIP-712)

Domain:
- `name`: `SecureVaultAuthorization`
- `version`: `1`
- `chainId`: current chain id
- `verifyingContract`: `AuthorizationManager` address

Type:

`WithdrawalAuthorization(address vault,address recipient,uint256 amount,bytes32 nonce)`

This binds permissions to:
- specific **vault instance** (`vault`)
- specific **network** (`chainId`)
- specific **recipient** (`recipient`)
- specific **amount** (`amount`)
- one-time uniqueness (`nonce`)

## Run locally with Docker

Requirement: Docker + docker-compose.

1. Start chain + deployer:

- `docker-compose up --build`

2. The deployer writes deployment output to `./deployments/deployment-31337.json` and logs it.

RPC endpoint from host:
- `http://127.0.0.1:8545`

## Run tests (recommended)

From host (Node 18+ recommended):

- `npm install`
- `npx hardhat test`

## Manual interaction notes

- Deposit by sending ETH directly to the deployed `SecureVault` address.
- Generate the EIP-712 signature off-chain using the **authorized signer** key.
- Call `withdraw(recipient, amount, nonce, signature)` on the vault.

The included tests (`tests/system.spec.js`) demonstrate:
- successful withdrawal
- replay prevention
- rejection of mismatched parameters
- rejection of direct manager calls by EOAs

## Files of interest

- `contracts/SecureVault.sol`
- `contracts/AuthorizationManager.sol`
- `scripts/deploy.js`
- `docker-compose.yml`
- `docker/Dockerfile`, `docker/entrypoint.sh`

## Known limitations

- This is a minimal reference implementation (single `authorizedSigner`).
- Authorization cancellation/expiry windows are not implemented (can be added by including `deadline` in typed data).
