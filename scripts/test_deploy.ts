import { deployVault } from "./src/executor/deployVault";
const mockBlueprint = {
  vault_name: "Test Vault",
  strategy_name: "Test Strat",
  rebalance_interval_hours: 24,
  min_apy_bps: 300,
  max_single_protocol_bps: 6000,
  allocations: []
};
deployVault(mockBlueprint, "Arbitrum Sepolia").then(addr => console.log("Success:", addr)).catch(err => console.error("Error:", err));
