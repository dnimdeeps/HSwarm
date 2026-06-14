// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAdapter} from "./interfaces/IAdapter.sol";
import {AutomationCompatibleInterface} from "./interfaces/IAutomation.sol";

struct PoolData {
    address adapter;
    uint256 currentApyBps;
    uint256 tvl;
    uint256 confidenceScore;
}

interface IHSwarmRebalancer {
    function compute_optimal_allocation(
        PoolData[] memory pools,
        uint256 max_single_protocol_bps,
        uint256 min_apy_bps
    ) external view returns (HSwarmVault.Allocation[] memory);
}

/// @title HSwarmVault
/// @notice ERC-4626 tokenized vault powered by HSwarm AI agent consensus.
/// @notice Strategy is set at deployment from the swarm's Step 4 blueprint.
/// @notice Chainlink Automation triggers rebalancing on a fixed interval.
contract HSwarmVault is ERC4626, Ownable, ReentrancyGuard, AutomationCompatibleInterface {
    using SafeERC20 for IERC20;

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct Allocation {
        address adapter;     // Protocol adapter contract
        uint256 targetPct;   // Target allocation in basis points (e.g. 5000 = 50%)
        string  protocolName; // Human-readable name, e.g. "Morpho Gauntlet USDC Prime"
    }

    // ─── State ────────────────────────────────────────────────────────────────

    string  public strategyName;
    uint256 public rebalanceInterval;    // seconds between automated rebalances
    uint256 public lastRebalanced;       // timestamp of last rebalance
    uint256 public minApyThresholdBps;   // minimum APY in bps (e.g. 300 = 3.00%)
    uint256 public maxSingleProtocolBps; // max allocation per protocol in bps
    uint256 public constant BPS = 10_000;

    address public stylusRebalancer; // Address of the Rust WASM contract for rebalancing math

    Allocation[] public allocations;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Rebalanced(uint256 timestamp, uint256 totalAssets);
    event AllocationUpdated(address indexed adapter, uint256 targetPct);
    event StrategyUpdated(string strategyName);
    event EmergencyWithdraw(uint256 amount);

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _asset             The base ERC20 asset (e.g. USDC)
    /// @param _name              Vault share token name (e.g. "HSwarm Conservative USDC")
    /// @param _symbol            Vault share token symbol (e.g. "hsUSDC")
    /// @param _strategyName      Human-readable strategy name from swarm blueprint
    /// @param _rebalanceInterval Seconds between Chainlink-triggered rebalances
    /// @param _minApyBps         Minimum acceptable APY in basis points
    /// @param _maxSinglePctBps   Max single protocol allocation in basis points
    constructor(
        address _asset,
        string memory _name,
        string memory _symbol,
        string memory _strategyName,
        uint256 _rebalanceInterval,
        uint256 _minApyBps,
        uint256 _maxSinglePctBps
    ) ERC4626(IERC20(_asset)) ERC20(_name, _symbol) Ownable(msg.sender) {
        strategyName      = _strategyName;
        rebalanceInterval = _rebalanceInterval;
        minApyThresholdBps = _minApyBps;
        maxSingleProtocolBps = _maxSinglePctBps;
        lastRebalanced    = block.timestamp;
    }

    // ─── Admin: Load Allocations ──────────────────────────────────────────────

    /// @notice Sets the allocations array from the swarm blueprint. Called once after deployment.
    /// @dev Allocations must sum to exactly BPS (10000)
    function setAllocations(Allocation[] calldata _allocations) external onlyOwner {
        require(_allocations.length > 0 && _allocations.length <= 10, "HSwarmVault: bad length");

        uint256 total = 0;
        for (uint256 i = 0; i < _allocations.length; i++) {
            require(_allocations[i].adapter != address(0), "HSwarmVault: zero adapter");
            require(_allocations[i].targetPct <= maxSingleProtocolBps, "HSwarmVault: exceeds max per protocol");
            total += _allocations[i].targetPct;
        }
        require(total == BPS, "HSwarmVault: allocations must sum to 10000");

        delete allocations;
        for (uint256 i = 0; i < _allocations.length; i++) {
            allocations.push(_allocations[i]);
            emit AllocationUpdated(_allocations[i].adapter, _allocations[i].targetPct);
        }
    }

    /// @notice Sets the Arbitrum Stylus Rust contract used for heavy off-chain rebalancing math
    function setStylusRebalancer(address _stylusRebalancer) external onlyOwner {
        stylusRebalancer = _stylusRebalancer;
    }

    // ─── Chainlink Automation ─────────────────────────────────────────────────

    /// @notice Chainlink node calls this every block to check if rebalance is needed
    function checkUpkeep(bytes calldata)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory)
    {
        upkeepNeeded = (
            allocations.length > 0 &&
            block.timestamp >= lastRebalanced + rebalanceInterval &&
            totalAssets() > 0
        );
    }

    /// @notice Chainlink node calls this to trigger the rebalance
    function performUpkeep(bytes calldata) external override {
        require(
            allocations.length > 0 &&
            block.timestamp >= lastRebalanced + rebalanceInterval &&
            totalAssets() > 0,
            "HSwarmVault: upkeep not needed"
        );
        _rebalance();
    }

    // ─── Core Rebalancing ─────────────────────────────────────────────────────

    /// @notice Manual rebalance trigger (owner only)
    function rebalance() external onlyOwner nonReentrant {
        _rebalance();
    }

    function _rebalance() internal {
        uint256 total = _withdrawAllFromAdapters();
        if (total == 0) return;

        // If Stylus is enabled, fetch the optimal math from WASM
        if (stylusRebalancer != address(0)) {
            // Mock fetching pool data from adapters/oracles
            PoolData[] memory poolData = new PoolData[](allocations.length);
            for (uint256 i = 0; i < allocations.length; i++) {
                // In production, this would fetch real APY/TVL from an Oracle
                poolData[i] = PoolData({
                    adapter: allocations[i].adapter,
                    currentApyBps: minApyThresholdBps + 100, // mock APY
                    tvl: 1_000_000e6, // mock TVL
                    confidenceScore: 90
                });
            }

            // Calls the Rust WASM contract -> incredibly cheap gas!
            Allocation[] memory newAllocs = IHSwarmRebalancer(stylusRebalancer)
                .compute_optimal_allocation(
                    poolData,
                    maxSingleProtocolBps,
                    minApyThresholdBps
                );
            
            if (newAllocs.length > 0) {
                delete allocations;
                for (uint256 i = 0; i < newAllocs.length; i++) {
                    allocations.push(newAllocs[i]);
                    emit AllocationUpdated(newAllocs[i].adapter, newAllocs[i].targetPct);
                }
            }
        }

        _deployCapital(total);

        lastRebalanced = block.timestamp;
        emit Rebalanced(block.timestamp, total);
    }

    function _withdrawAllFromAdapters() internal returns (uint256 totalWithdrawn) {
        for (uint256 i = 0; i < allocations.length; i++) {
            IAdapter(allocations[i].adapter).withdrawAll();
        }
        totalWithdrawn = IERC20(asset()).balanceOf(address(this));
    }

    function _withdrawProportionally(uint256 requiredAmount) internal {
        uint256 totalDeployed = 0;
        for (uint256 i = 0; i < allocations.length; i++) {
            totalDeployed += IAdapter(allocations[i].adapter).balance();
        }
        
        if (totalDeployed == 0) return;


        uint256 actuallyWithdrawn = 0;

        for (uint256 i = 0; i < allocations.length; i++) {
            IAdapter adapter = IAdapter(allocations[i].adapter);
            uint256 adapterBal = adapter.balance();
            if (adapterBal > 0) {
                uint256 pullAmount = (adapterBal * requiredAmount) / totalDeployed;
                if (pullAmount > 0) {
                    if (pullAmount > adapterBal) pullAmount = adapterBal;
                    adapter.withdraw(pullAmount);
                    actuallyWithdrawn += pullAmount;
                }
            }
        }

        // Deal with rounding dust
        if (actuallyWithdrawn < requiredAmount) {
            uint256 shortfall = requiredAmount - actuallyWithdrawn;
            for (uint256 i = 0; i < allocations.length && shortfall > 0; i++) {
                IAdapter adapter = IAdapter(allocations[i].adapter);
                uint256 adapterBal = adapter.balance();
                if (adapterBal > 0) {
                    uint256 pullAmount = adapterBal < shortfall ? adapterBal : shortfall;
                    adapter.withdraw(pullAmount);
                    shortfall -= pullAmount;
                }
            }
        }
    }



    function _deployCapital(uint256 total) internal {
        IERC20 token = IERC20(asset());
        for (uint256 i = 0; i < allocations.length; i++) {
            uint256 amount = (total * allocations[i].targetPct) / BPS;
            if (amount == 0) continue;
            // Approve the adapter to pull exactly `amount` from the vault
            token.approve(allocations[i].adapter, amount);
            IAdapter(allocations[i].adapter).deposit(amount);
            // Reset approval to 0 after deposit for security
            token.approve(allocations[i].adapter, 0);
        }
    }

    // ─── ERC-4626 Overrides ───────────────────────────────────────────────────

    /// @notice Returns total assets including those deployed in adapters
    function totalAssets() public view override returns (uint256 total) {
        total = IERC20(asset()).balanceOf(address(this));
        for (uint256 i = 0; i < allocations.length; i++) {
            total += IAdapter(allocations[i].adapter).balance();
        }
    }

    /// @notice On deposit, immediately deploy capital to protocol adapters
    function _afterDeposit(uint256 assets) internal {
        if (allocations.length > 0 && assets > 0) {
            _deployCapital(assets);
        }
    }

    // Intercept the ERC4626 internal deposit to add our hook
    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        shares = super.deposit(assets, receiver);
        _afterDeposit(assets);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        assets = super.mint(shares, receiver);
        _afterDeposit(assets);
    }

    /// @notice On withdrawal, pull funds back from adapters proportionally
    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        // Ensure vault has enough liquid assets
        uint256 liquid = IERC20(asset()).balanceOf(address(this));
        if (liquid < assets) {
            _withdrawProportionally(assets - liquid);
        }
        shares = super.withdraw(assets, receiver, owner_);
    }

    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        // Calculate the exact amount of assets the shares represent
        assets = previewRedeem(shares);
        
        // Ensure vault has enough liquid assets
        uint256 liquid = IERC20(asset()).balanceOf(address(this));
        if (liquid < assets) {
            _withdrawProportionally(assets - liquid);
        }
        
        // super.redeem recalculates previewRedeem(shares), so it's safe.
        assets = super.redeem(shares, receiver, owner_);
    }

    // ─── Emergency ────────────────────────────────────────────────────────────

    /// @notice Emergency: pull all funds from adapters back to vault
    function emergencyWithdrawAll() external onlyOwner {
        uint256 before = IERC20(asset()).balanceOf(address(this));
        _withdrawAllFromAdapters();
        uint256 withdrawn = IERC20(asset()).balanceOf(address(this)) - before;
        emit EmergencyWithdraw(withdrawn);
    }

    // ─── View Helpers ─────────────────────────────────────────────────────────

    function getAllocationsCount() external view returns (uint256) {
        return allocations.length;
    }

    function getAllocation(uint256 index) external view returns (Allocation memory) {
        return allocations[index];
    }

    function timeUntilNextRebalance() external view returns (uint256) {
        uint256 next = lastRebalanced + rebalanceInterval;
        if (block.timestamp >= next) return 0;
        return next - block.timestamp;
    }
}
