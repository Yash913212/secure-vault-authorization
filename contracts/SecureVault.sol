// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAuthorizationManager {
    function verifyAuthorization(
        address vault,
        address recipient,
        uint256 amount,
        bytes32 nonce,
        bytes calldata signature
    ) external returns (bool);
}

/// @notice Holds pooled native currency and executes withdrawals only after on-chain authorization validation.
/// @dev Does NOT perform signature verification; relies exclusively on AuthorizationManager.
contract SecureVault is ReentrancyGuard {
    error ZeroAddress();
    error InsufficientBalance(uint256 available, uint256 required);
    error AuthorizationFailed();
    error TransferFailed();

    IAuthorizationManager public immutable authorizationManager;

    /// @dev Internal accounting updated exactly once per successful deposit/withdraw.
    uint256 public accountedBalance;

    event Deposit(address indexed from, uint256 amount, uint256 newAccountedBalance);
    event Withdrawal(address indexed to, uint256 amount, uint256 newAccountedBalance);

    constructor(address manager) {
        if (manager == address(0)) revert ZeroAddress();
        authorizationManager = IAuthorizationManager(manager);
    }

    receive() external payable {
        accountedBalance += msg.value;
        emit Deposit(msg.sender, msg.value, accountedBalance);
    }

    /// @notice Withdraws funds to `recipient` when authorized.
    /// @dev Critical state update happens before value transfer. Authorization is consumed by the manager.
    function withdraw(
        address payable recipient,
        uint256 amount,
        bytes32 nonce,
        bytes calldata signature
    ) external nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();

        uint256 available = accountedBalance;
        if (amount > available) revert InsufficientBalance(available, amount);

        bool ok = authorizationManager.verifyAuthorization(address(this), recipient, amount, nonce, signature);
        if (!ok) revert AuthorizationFailed();

        // Update accounting exactly once *before* transferring value.
        accountedBalance = available - amount;

        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit Withdrawal(recipient, amount, accountedBalance);
    }
}
