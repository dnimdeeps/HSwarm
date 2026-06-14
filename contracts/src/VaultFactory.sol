// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HSwarmVault} from "./HSwarmVault.sol";

contract VaultFactory {
    event VaultCreated(address indexed vaultAddress, string strategyName);

    function createVault(
        address asset,
        string memory name,
        string memory symbol,
        string memory strategyName,
        uint256 rebalanceInterval,
        uint256 minApyBps,
        uint256 maxSinglePctBps
    ) external returns (address) {
        HSwarmVault vault = new HSwarmVault(
            asset,
            name,
            symbol,
            strategyName,
            rebalanceInterval,
            minApyBps,
            maxSinglePctBps
        );

        // Transfer ownership of the vault back to the caller (e.g. backend wallet)
        vault.transferOwnership(msg.sender);

        emit VaultCreated(address(vault), strategyName);
        return address(vault);
    }
}
