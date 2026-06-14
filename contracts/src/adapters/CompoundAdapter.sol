// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAdapter} from "../interfaces/IAdapter.sol";
import {IComet} from "../interfaces/IComet.sol";

/// @title CompoundAdapter
/// @notice Deposits vault funds into Compound V3 (Comet) on Arbitrum
/// @dev cUSDCv3 proxy: 0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA
contract CompoundAdapter is IAdapter {
    using SafeERC20 for IERC20;

    IComet  public immutable comet;
    IERC20  public immutable baseAsset;
    address public immutable vault;

    modifier onlyVault() {
        require(msg.sender == vault, "CompoundAdapter: only vault");
        _;
    }

    constructor(address _comet, address _asset, address _vault) {
        comet     = IComet(_comet);
        baseAsset = IERC20(_asset);
        vault     = _vault;
    }

    /// @inheritdoc IAdapter
    function deposit(uint256 amount) external onlyVault {
        baseAsset.safeTransferFrom(vault, address(this), amount);
        baseAsset.forceApprove(address(comet), amount);
        comet.supply(address(baseAsset), amount);
    }

    /// @inheritdoc IAdapter
    function withdrawAll() external onlyVault {
        uint256 bal = comet.balanceOf(address(this));
        if (bal == 0) return;
        comet.withdraw(address(baseAsset), bal);
    }

    /// @inheritdoc IAdapter
    function withdraw(uint256 amount) external onlyVault {
        if (amount == 0) return;
        comet.withdraw(address(baseAsset), amount);
    }

    /// @inheritdoc IAdapter
    function balance() external view returns (uint256) {
        return comet.balanceOf(address(this));
    }

    /// @inheritdoc IAdapter
    function asset() external view returns (address) {
        return address(baseAsset);
    }
}
