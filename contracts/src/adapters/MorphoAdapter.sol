// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAdapter} from "../interfaces/IAdapter.sol";
import {IERC4626Minimal} from "../interfaces/IMorpho.sol";

/// @title MorphoAdapter
/// @notice Deposits vault funds into a Morpho ERC-4626 vault on Arbitrum
/// @dev Morpho vaults are standard ERC-4626, making this adapter simple and clean
contract MorphoAdapter is IAdapter {
    using SafeERC20 for IERC20;

    IERC4626Minimal public immutable morphoVault;
    IERC20          public immutable baseAsset;
    address         public immutable vault;

    modifier onlyVault() {
        require(msg.sender == vault, "MorphoAdapter: only vault");
        _;
    }

    constructor(address _morphoVault, address _asset, address _vault) {
        morphoVault = IERC4626Minimal(_morphoVault);
        baseAsset   = IERC20(_asset);
        vault       = _vault;
    }

    /// @inheritdoc IAdapter
    function deposit(uint256 amount) external onlyVault {
        baseAsset.safeTransferFrom(vault, address(this), amount);
        baseAsset.forceApprove(address(morphoVault), amount);
        morphoVault.deposit(amount, address(this));
    }

    /// @inheritdoc IAdapter
    function withdrawAll() external onlyVault {
        uint256 shares = morphoVault.balanceOf(address(this));
        if (shares == 0) return;
        morphoVault.redeem(shares, vault, address(this));
    }

    /// @inheritdoc IAdapter
    function withdraw(uint256 amount) external onlyVault {
        if (amount == 0) return;
        morphoVault.withdraw(amount, vault, address(this));
    }


    /// @inheritdoc IAdapter
    function balance() external view returns (uint256) {
        uint256 shares = morphoVault.balanceOf(address(this));
        if (shares == 0) return 0;
        return morphoVault.convertToAssets(shares);
    }

    /// @inheritdoc IAdapter
    function asset() external view returns (address) {
        return address(baseAsset);
    }
}
