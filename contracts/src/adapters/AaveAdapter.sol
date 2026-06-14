// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAdapter} from "../interfaces/IAdapter.sol";
import {IAaveV3Pool, IAToken} from "../interfaces/IAaveV3Pool.sol";

/// @title AaveAdapter
/// @notice Deposits vault funds into Aave V3 on Arbitrum
/// @dev Aave V3 Pool on Arbitrum: 0x794a61358D6845594F94dc1DB02A252b5b4814aD
contract AaveAdapter is IAdapter {
    using SafeERC20 for IERC20;

    IAaveV3Pool public immutable pool;
    IAToken    public immutable aToken;
    IERC20     public immutable baseAsset;
    address    public immutable vault;

    modifier onlyVault() {
        require(msg.sender == vault, "AaveAdapter: only vault");
        _;
    }

    constructor(address _pool, address _aToken, address _asset, address _vault) {
        pool      = IAaveV3Pool(_pool);
        aToken    = IAToken(_aToken);
        baseAsset = IERC20(_asset);
        vault     = _vault;
    }

    /// @inheritdoc IAdapter
    function deposit(uint256 amount) external onlyVault {
        baseAsset.safeTransferFrom(vault, address(this), amount);
        baseAsset.forceApprove(address(pool), amount);
        pool.supply(address(baseAsset), amount, address(this), 0);
    }

    /// @inheritdoc IAdapter
    function withdrawAll() external onlyVault {
        uint256 bal = aToken.balanceOf(address(this));
        if (bal == 0) return;
        pool.withdraw(address(baseAsset), type(uint256).max, vault);
    }

    /// @inheritdoc IAdapter
    function withdraw(uint256 amount) external onlyVault {
        if (amount == 0) return;
        pool.withdraw(address(baseAsset), amount, vault);
    }


    /// @inheritdoc IAdapter
    function balance() external view returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    /// @inheritdoc IAdapter
    function asset() external view returns (address) {
        return address(baseAsset);
    }
}
