// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAdapter} from "../interfaces/IAdapter.sol";

contract MockAdapter is IAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable baseAsset;
    address public immutable vault;
    string public protocolName;
    uint256 private _balance;

    event Deposited(uint256 amount);
    event Withdrawn(uint256 amount);

    constructor(address _baseAsset, address _vault, string memory _protocolName) {
        baseAsset = IERC20(_baseAsset);
        vault = _vault;
        protocolName = _protocolName;
    }

    modifier onlyVault() {
        require(msg.sender == vault, "MockAdapter: only vault");
        _;
    }

    function deposit(uint256 amount) external override onlyVault {
        baseAsset.safeTransferFrom(vault, address(this), amount);
        _balance += amount;
        emit Deposited(amount);
    }

    function withdraw(uint256 amount) external override onlyVault {
        require(_balance >= amount, "MockAdapter: insufficient balance");
        _balance -= amount;
        baseAsset.safeTransfer(vault, amount);
        emit Withdrawn(amount);
    }

    function withdrawAll() external override onlyVault {
        uint256 amount = _balance;
        _balance = 0;
        baseAsset.safeTransfer(vault, amount);
        emit Withdrawn(amount);
    }

    function balance() external view override returns (uint256) {
        // Simulate a tiny bit of yield (+0.1%) when someone checks balance
        return _balance + (_balance / 1000); 
    }

    function asset() external view override returns (address) {
        return address(baseAsset);
    }
}
