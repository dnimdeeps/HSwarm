// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HSwarmVault} from "../src/HSwarmVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IAdapter} from "../src/interfaces/IAdapter.sol";

/// @notice Mock ERC20 asset for testing
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    function decimals() public pure override returns (uint8) { return 6; }
}

/// @notice Mock adapter for testing
contract MockAdapter is IAdapter {
    address public immutable _asset;
    uint256 internal _balance;

    constructor(address asset_) { _asset = asset_; }

    function deposit(uint256 amount) external override {
        ERC20(_asset).transferFrom(msg.sender, address(this), amount);
        _balance += amount;
    }

    function withdrawAll() external override {
        if (_balance == 0) return;
        ERC20(_asset).transfer(msg.sender, _balance);
        _balance = 0;
    }



    function withdraw(uint256 amount) external override {
        require(_balance >= amount, "MockAdapter: insufficient balance");
        ERC20(_asset).transfer(msg.sender, amount);
        _balance -= amount;
    }

    function balance() external view override returns (uint256) { return _balance; }
    function asset() external view override returns (address) { return _asset; }
}

contract HSwarmVaultTest is Test {
    HSwarmVault  vault;
    MockUSDC     usdc;
    MockAdapter  adapterA;
    MockAdapter  adapterB;

    address alice = makeAddr("alice");
    address bob   = makeAddr("bob");

    uint256 constant ONE_USDC = 1e6;

    function setUp() public {
        usdc = new MockUSDC();

        vault = new HSwarmVault(
            address(usdc),
            "HSwarm Conservative USDC",
            "hsUSDC",
            "Conservative USDC Yield Optimizer",
            86400,   // 1 day rebalance interval
            300,     // 3% min APY
            6000     // 60% max per protocol
        );

        adapterA = new MockAdapter(address(usdc));
        adapterB = new MockAdapter(address(usdc));

        // Set allocations: 60% A, 40% B
        HSwarmVault.Allocation[] memory allocs = new HSwarmVault.Allocation[](2);
        allocs[0] = HSwarmVault.Allocation(address(adapterA), 6000, "Morpho Gauntlet USDC");
        allocs[1] = HSwarmVault.Allocation(address(adapterB), 4000, "Aave V3 USDC");
        vault.setAllocations(allocs);

        // Mint USDC to test users
        usdc.mint(alice, 1000 * ONE_USDC);
        usdc.mint(bob,   500  * ONE_USDC);
    }

    function test_depositDeploysCapital() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 100 * ONE_USDC);
        uint256 shares = vault.deposit(100 * ONE_USDC, alice);
        vm.stopPrank();

        assertGt(shares, 0, "Should have received shares");
        assertEq(adapterA.balance(), 60 * ONE_USDC, "60% in adapter A");
        assertEq(adapterB.balance(), 40 * ONE_USDC, "40% in adapter B");
        assertEq(vault.totalAssets(), 100 * ONE_USDC, "Total assets correct");
    }

    function test_withdrawPullsFromAdapters() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 100 * ONE_USDC);
        vault.deposit(100 * ONE_USDC, alice);

        uint256 balBefore = usdc.balanceOf(alice);
        vault.withdraw(50 * ONE_USDC, alice, alice);
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice) - balBefore, 50 * ONE_USDC, "Alice receives 50 USDC");
    }

    function test_checkUpkeep_returnsFalseBeforeInterval() public {
        (bool needed,) = vault.checkUpkeep("");
        assertFalse(needed, "Upkeep not needed immediately after deployment");
    }

    function test_checkUpkeep_returnsTrueAfterInterval() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 100 * ONE_USDC);
        vault.deposit(100 * ONE_USDC, alice);
        vm.stopPrank();

        vm.warp(block.timestamp + 86401);
        (bool needed,) = vault.checkUpkeep("");
        assertTrue(needed, "Upkeep needed after interval");
    }

    function test_performUpkeep_rebalances() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 100 * ONE_USDC);
        vault.deposit(100 * ONE_USDC, alice);
        vm.stopPrank();

        vm.warp(block.timestamp + 86401);
        vault.performUpkeep("");

        assertEq(adapterA.balance(), 60 * ONE_USDC);
        assertEq(adapterB.balance(), 40 * ONE_USDC);
        assertGt(vault.lastRebalanced(), 0);
    }

    function test_multipleDepositors() public {
        vm.prank(alice);
        usdc.approve(address(vault), 100 * ONE_USDC);
        vm.prank(alice);
        vault.deposit(100 * ONE_USDC, alice);

        vm.prank(bob);
        usdc.approve(address(vault), 50 * ONE_USDC);
        vm.prank(bob);
        vault.deposit(50 * ONE_USDC, bob);

        assertEq(vault.totalAssets(), 150 * ONE_USDC);
    }

    function test_emergencyWithdraw() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 100 * ONE_USDC);
        vault.deposit(100 * ONE_USDC, alice);
        vm.stopPrank();

        vault.emergencyWithdrawAll();

        assertEq(adapterA.balance(), 0);
        assertEq(adapterB.balance(), 0);
        assertEq(usdc.balanceOf(address(vault)), 100 * ONE_USDC);
    }
}
