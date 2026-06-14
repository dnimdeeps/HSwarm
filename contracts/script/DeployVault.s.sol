// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {HSwarmVault} from "../src/HSwarmVault.sol";
import {MorphoAdapter} from "../src/adapters/MorphoAdapter.sol";
import {AaveAdapter} from "../src/adapters/AaveAdapter.sol";

/// @notice Deployment script for HSwarmVault on Arbitrum
///
/// @dev Usage:
///   source .env
///   forge script script/DeployVault.s.sol \
///     --rpc-url $ARBITRUM_SEPOLIA_RPC_URL \
///     --private-key $PRIVATE_KEY \
///     --broadcast \
///     --verify
///
/// @dev The private key is NEVER read inside this script.
///      It is passed exclusively via the CLI --private-key flag.
///      vm.startBroadcast() with no argument picks it up automatically.
contract DeployVault is Script {
    // ─── Arbitrum Protocol Addresses ──────────────────────────────────────────
    // USDC (testnet USDC) on Arbitrum Sepolia
    address constant USDC          = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    // Aave V3 Pool on Arbitrum Sepolia
    address constant AAVE_V3_POOL  = 0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff;
    // aUSDC token on Arbitrum Sepolia
    address constant AAVE_AUSDC    = 0x460b97BD498E1157530AEb3086301d5225b91216;

    // Sentinel: if VAULT_MORPHO_VAULT_ADDRESS is 0x1 or address(0), skip Morpho
    address constant DUMMY_ADDRESS = address(1);

    function run() external {
        // ─── All strategy params come from .env (written by Step 5) ──────────
        string  memory strategyName      = vm.envString("VAULT_STRATEGY_NAME");
        uint256        rebalanceInterval = vm.envUint("VAULT_REBALANCE_INTERVAL");   // seconds
        uint256        minApyBps         = vm.envUint("VAULT_MIN_APY_BPS");          // e.g. 300 = 3%
        uint256        maxSinglePctBps   = vm.envUint("VAULT_MAX_SINGLE_PCT_BPS");   // e.g. 6000 = 60%
        uint256        morphoBps         = vm.envUint("VAULT_MORPHO_PCT_BPS");       // e.g. 6000
        uint256        aaveBps           = vm.envUint("VAULT_AAVE_PCT_BPS");         // e.g. 4000
        address        morphoVault       = vm.envAddress("VAULT_MORPHO_VAULT_ADDRESS");

        // ─── Detect if Morpho vault address is a valid contract (not placeholder) ──
        bool useMorpho = morphoVault != address(0) && morphoVault != DUMMY_ADDRESS;

        // ─── If Morpho is disabled, redirect all allocation to Aave ──────────
        if (!useMorpho) {
            aaveBps = 10_000; // 100% to Aave when Morpho is unavailable
            morphoBps = 0;
            maxSinglePctBps = 10_000; // Allow 100% single allocation
        } else {
            // ─── AI Fallback Fix: Ensure maxSinglePctBps is large enough ──────────
            if (morphoBps > maxSinglePctBps) maxSinglePctBps = morphoBps;
            if (aaveBps > maxSinglePctBps) maxSinglePctBps = aaveBps;
        }

        // ─── Broadcast (signer = --private-key passed on CLI, not in code) ───
        vm.startBroadcast();

        // 1. Deploy the HSwarmVault (ERC-4626 + Chainlink Automation)
        HSwarmVault vault = new HSwarmVault(
            USDC,
            "HSwarm Conservative USDC",
            "hsUSDC",
            strategyName,
            rebalanceInterval,
            minApyBps,
            maxSinglePctBps
        );
        console.log("HSwarmVault        :", address(vault));

        // 2. Deploy protocol adapters
        AaveAdapter aaveAdapter = new AaveAdapter(
            AAVE_V3_POOL,
            AAVE_AUSDC,
            USDC,
            address(vault)
        );
        console.log("AaveAdapter        :", address(aaveAdapter));

        // 3. Build allocation array (conditionally include Morpho)
        if (useMorpho) {
            MorphoAdapter morphoAdapter = new MorphoAdapter(
                morphoVault,
                USDC,
                address(vault)
            );
            console.log("MorphoAdapter      :", address(morphoAdapter));

            HSwarmVault.Allocation[] memory allocs = new HSwarmVault.Allocation[](2);
            allocs[0] = HSwarmVault.Allocation(address(morphoAdapter), morphoBps, "Morpho Gauntlet USDC Prime");
            allocs[1] = HSwarmVault.Allocation(address(aaveAdapter),   aaveBps,   "Aave V3 USDC");
            vault.setAllocations(allocs);
            console.log("Allocations set: Morpho + Aave");
        } else {
            // Testnet fallback: Aave-only (Morpho doesn't have a real USDC vault on Arbitrum Sepolia)
            HSwarmVault.Allocation[] memory allocs = new HSwarmVault.Allocation[](1);
            allocs[0] = HSwarmVault.Allocation(address(aaveAdapter), aaveBps, "Aave V3 USDC");
            vault.setAllocations(allocs);
            console.log("Allocations set: Aave-only (Morpho address was placeholder)");
        }

        vm.stopBroadcast();

        // ─── Deployment summary (printed after broadcast, no gas cost) ────────
        console.log("\n=== HSWARM VAULT DEPLOYMENT SUMMARY ===");
        console.log("Chain             : Arbitrum Sepolia");
        console.log("HSwarmVault       :", address(vault));
        console.log("AaveAdapter       :", address(aaveAdapter));
        console.log("Strategy          :", strategyName);
        console.log("Rebalance every   : %d seconds", rebalanceInterval);
        if (useMorpho) {
            console.log("Morpho allocation : %d bps (%d%%)", morphoBps, morphoBps / 100);
        } else {
            console.log("Morpho allocation : SKIPPED (placeholder address)");
        }
        console.log("Aave allocation   : %d bps (%d%%)", aaveBps, aaveBps / 100);
        console.log("Min APY threshold : %d bps (%d.%d%%)", minApyBps, minApyBps / 100, minApyBps % 100);
    }
}
