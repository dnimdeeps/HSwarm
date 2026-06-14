// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAdapter
/// @notice Common interface for all protocol adapters used by HSwarmVault
interface IAdapter {
    /// @notice Deposits `amount` of the base asset into the underlying protocol
    function deposit(uint256 amount) external;

    /// @notice Withdraws all funds from the underlying protocol back to the vault
    function withdrawAll() external;

    /// @notice Withdraws a specific amount from the underlying protocol
    function withdraw(uint256 amount) external;

    /// @notice Returns the current balance (principal + yield) held in this adapter
    function balance() external view returns (uint256);

    /// @notice Returns the address of the underlying asset (e.g. USDC)
    function asset() external view returns (address);
}
