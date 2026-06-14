// Only run this as a WASM if the export-abi feature is not set.
#![cfg_attr(not(feature = "export-abi"), no_main)]
extern crate alloc;

/// Import the Stylus SDK along with alloy primitive types for use in our smart contract.
use stylus_sdk::{alloy_primitives::{U256, Address}, prelude::*};
use alloc::vec::Vec;

/// Define the custom structs that represent our input and output data.
/// These correspond exactly to the ABI encoding expected by the Solidity vault.
sol! {
    struct PoolData {
        address adapter;
        uint256 currentApyBps;
        uint256 tvl;
        uint256 confidenceScore; // From 0 to 100
    }

    struct Allocation {
        address adapter;
        uint256 targetPctBps; // 10000 = 100%
    }
}

// Global allocator for WASM optimization
#[global_allocator]
static ALLOC: mini_alloc::MiniAlloc = mini_alloc::MiniAlloc::INIT;

/// The main storage struct for our Stylus contract.
/// Even though this contract is stateless (pure computation), 
/// Stylus requires a struct to attach the external functions to.
#[solidity_storage]
#[entrypoint]
pub struct HSwarmRebalancer {}

#[external]
impl HSwarmRebalancer {
    /// Computes the optimal allocation across multiple pools.
    /// This is where the Stylus WASM advantage shines: performing heavy 
    /// math and sorting arrays is 10-100x cheaper in Rust than Solidity.
    pub fn compute_optimal_allocation(
        &self,
        pools: Vec<PoolData>,
        max_single_protocol_bps: U256,
        min_apy_bps: U256,
    ) -> Result<Vec<Allocation>, Vec<u8>> {
        let mut valid_pools = Vec::new();

        // 1. Filter out pools that don't meet our minimum APY
        for pool in pools.iter() {
            if pool.currentApyBps >= min_apy_bps && pool.confidenceScore > U256::from(50) {
                valid_pools.push(pool.clone());
            }
        }

        if valid_pools.is_empty() {
            // Fallback: if no pools are valid, return an empty allocation (withdraw to cash)
            return Ok(Vec::new());
        }

        // 2. Score the pools. Score = (APY * TVL * Confidence)
        // In Solidity, multiplying large numbers and sorting an array costs massive gas.
        // In Stylus WASM, this is almost free.
        let mut scored_pools: Vec<(usize, U256)> = valid_pools
            .iter()
            .enumerate()
            .map(|(i, p)| {
                // Simplified scoring math for demonstration
                let score = p.currentApyBps * p.tvl * p.confidenceScore;
                (i, score)
            })
            .collect();

        // Sort descending by score
        scored_pools.sort_by(|a, b| b.1.cmp(&a.1));

        let total_score: U256 = scored_pools.iter().map(|(_, score)| *score).sum();
        let max_bps = max_single_protocol_bps;
        let mut remaining_bps = U256::from(10000); // 100% = 10000 bps

        let mut allocations = Vec::new();

        // 3. Distribute BPS proportionally based on score, capped by max_single_protocol_bps
        for (i, score) in scored_pools {
            let pool = &valid_pools[i];
            
            // Proportional allocation: (score / total_score) * 10000
            let mut target_bps = (score * U256::from(10000)) / total_score;

            // Cap at max single protocol
            if target_bps > max_bps {
                target_bps = max_bps;
            }

            // Cap at remaining total bps to prevent overflow > 10000
            if target_bps > remaining_bps {
                target_bps = remaining_bps;
            }

            allocations.push(Allocation {
                adapter: pool.adapter,
                targetPctBps: target_bps,
            });

            remaining_bps -= target_bps;

            if remaining_bps == U256::ZERO {
                break;
            }
        }

        Ok(allocations)
    }
}
