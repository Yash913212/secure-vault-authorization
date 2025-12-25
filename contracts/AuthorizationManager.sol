// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Validates and consumes withdrawal authorizations (generated off-chain).
/// @dev The vault relies exclusively on this contract for signature verification.
contract AuthorizationManager is EIP712 {
    error ZeroAddress();
    error NotVault(address caller);
    error VaultNotSet();
    error VaultMismatch(address expectedVault, address providedVault);
    error VaultAlreadySet(address vault);
    error InvalidSignature(address recoveredSigner);
    error AuthorizationAlreadyUsed(bytes32 authorizationId);

    /// @dev Off-chain signer whose signatures are accepted.
    address public immutable authorizedSigner;

    /// @dev Vault allowed to consume authorizations (set exactly once post-deploy).
    address public vault;

    mapping(bytes32 authorizationId => bool consumed) public consumed;

    bytes32 private constant WITHDRAWAL_TYPEHASH =
        keccak256("WithdrawalAuthorization(address vault,address recipient,uint256 amount,bytes32 nonce)");

    event VaultSet(address indexed vault);
    event AuthorizationConsumed(
        bytes32 indexed authorizationId,
        address indexed vault,
        address indexed recipient,
        uint256 amount,
        bytes32 nonce
    );

    constructor(address signer) EIP712("SecureVaultAuthorization", "1") {
        if (signer == address(0)) revert ZeroAddress();
        authorizedSigner = signer;
    }

    /// @notice Sets the vault allowed to consume authorizations.
    /// @dev Callable exactly once.
    function setVault(address _vault) external {
        if (vault != address(0)) revert VaultAlreadySet(vault);
        if (_vault == address(0)) revert ZeroAddress();
        vault = _vault;
        emit VaultSet(_vault);
    }

    /// @notice Computes the EIP-712 authorization id (digest) for observability / tooling.
    function getAuthorizationId(
        address _vault,
        address recipient,
        uint256 amount,
        bytes32 nonce
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(WITHDRAWAL_TYPEHASH, _vault, recipient, amount, nonce));
        return _hashTypedDataV4(structHash);
    }

    /// @notice View-only helper for off-chain tooling / debugging.
    /// @dev Does not check vault caller or consume anything.
    function previewAuthorization(
        address _vault,
        address recipient,
        uint256 amount,
        bytes32 nonce,
        bytes calldata signature
    ) external view returns (bytes32 authorizationId, address recoveredSigner, bool isConsumed) {
        authorizationId = getAuthorizationId(_vault, recipient, amount, nonce);
        recoveredSigner = ECDSA.recover(authorizationId, signature);
        isConsumed = consumed[authorizationId];
    }

    /// @notice Verifies authenticity, enforces single-use, and consumes the authorization.
    /// @dev Must be called by the configured vault. Consumes on success.
    function verifyAuthorization(
        address _vault,
        address recipient,
        uint256 amount,
        bytes32 nonce,
        bytes calldata signature
    ) external returns (bool) {
        address v = vault;
        if (v == address(0)) revert VaultNotSet();
        if (msg.sender != v) revert NotVault(msg.sender);
        if (_vault != v) revert VaultMismatch(v, _vault);

        bytes32 authorizationId = getAuthorizationId(_vault, recipient, amount, nonce);
        if (consumed[authorizationId]) revert AuthorizationAlreadyUsed(authorizationId);

        address recovered = ECDSA.recover(authorizationId, signature);
        if (recovered != authorizedSigner) revert InvalidSignature(recovered);

        consumed[authorizationId] = true;
        emit AuthorizationConsumed(authorizationId, _vault, recipient, amount, nonce);
        return true;
    }
}
