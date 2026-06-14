// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface for Compound V3 (Comet) on Arbitrum
/// @dev cUSDCv3 proxy: 0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA
interface IComet {
    function supply(address asset, uint256 amount) external;
    function withdraw(address asset, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}
