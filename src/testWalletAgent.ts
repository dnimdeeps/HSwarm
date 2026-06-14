import { runWalletAgent } from "./executor/walletManager";

// Pass the Vault Address you got from deployment!
const vaultAddress = "0x703D156fC22CB3cB3267420a9f859204aEf2c3B9"; // Replace with latest if needed
const isMainnet = process.argv.includes("--mainnet");

async function main() {
    const networkLabel = isMainnet ? "Arbitrum One" : "Arbitrum Sepolia";
    const task = `Check your ${networkLabel} ETH balance to make sure you have gas, then call the rebalance_vault tool.`;
    
    await runWalletAgent(vaultAddress, task, isMainnet);
}

main().catch(console.error);
