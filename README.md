Secure Vault Authorization

Two small contracts, one clear job each:

-> `SecureVault.sol` holds ETH and performs withdrawals.
-> `AuthorizationManager.sol` verifies (and permanently consumes) off-chain signed withdrawal approvals.

Design choice: the vault **does not** recover signatures itself. It asks the authorization manager to validate permission.

How it works (high level)

1. Anyone deposits ETH into `SecureVault` (a plain ETH transfer).
2. Off-chain, an `authorizedSigner` signs an EIP-712 “withdrawal authorization”.
3. Anyone can submit that signed authorization to the vault via `SecureVault.withdraw(...)`.
4. The vault calls `AuthorizationManager.verifyAuthorization(...)`.
5. The manager checks:
   - the caller really is the configured vault
   - the authorization is for this vault instance
   - the signature is valid on this chain (EIP-712 domain includes `chainId`)
   - the authorization hasn’t been used before (replay protection)
6. If everything checks out, the vault updates accounting and transfers ETH.

Security properties (what this protects)

- Single-use approvals: the manager stores `consumed[authorizationId]` and marks an authorization as used on success.
- Scoped permissions: signed data includes `(vault, recipient, amount, nonce)`.
- Chain-bound signatures: the EIP-712 domain binds to `(chainId, verifyingContract = AuthorizationManager)`.
- Safer accounting: `SecureVault.accountedBalance` is decremented **before** the ETH transfer.
- Vault-only consumption: EOAs can’t successfully call `verifyAuthorization` directly.
- One-time initialization: `AuthorizationManager.setVault(...)` can only be called once.

What exactly gets signed (EIP-712)

Domain:
- `name`: `SecureVaultAuthorization`
- `version`: `1`
- `chainId`: current chain id
- `verifyingContract`: `AuthorizationManager` address

Type:

`WithdrawalAuthorization(address vault,address recipient,uint256 amount,bytes32 nonce)`

This binds permission to:
- a specific vault instance (`vault`)
- a specific network (`chainId`)
- a specific recipient (`recipient`)
- a specific amount (`amount`)
- a one-time uniqueness value (`nonce`)

Quickstart (Docker)

You’ll get a local chain (Anvil) plus an auto-deployer.

Requirement: Docker Desktop + Docker Compose.

1. Start everything:

- `docker compose up --build`

2. Wait for the deployer to finish. You should see a “Deployed:” JSON blob and then:

- `Wrote deployment artifact: /app/deployments/deployment-31337.json`

3. On your host machine, the artifact will be available at:

- `./deployments/deployment-31337.json`

RPC endpoint from the host:
- `http://127.0.0.1:8545`

Run tests (recommended)

From the host machine:

- `npm install`
- `npm test`

Manual interaction notes

- Deposit by sending ETH directly to the deployed `SecureVault` address.
- Off-chain, generate the EIP-712 signature using the **authorized signer** private key.
- Call `withdraw(recipient, amount, nonce, signature)` on the vault.

The included system tests (`tests/system.spec.js`) cover:
- a successful withdrawal
- replay prevention
- rejection of mismatched parameters
- rejection of direct manager calls by EOAs

Where to look

- `contracts/SecureVault.sol`
- `contracts/AuthorizationManager.sol`
- `scripts/deploy.js`
- `docker-compose.yml`
- `docker/Dockerfile`, `docker/entrypoint.sh`

Known limitations / easy extensions

- This is a minimal reference implementation (a single `authorizedSigner`).
- Authorization cancellation/expiry windows are not implemented.
   - Easy upgrade: add a `deadline` field to the typed data and enforce it in `AuthorizationManager`.
