import { initializeAgentWallet } from "./executor/walletAgent";

const vaultAddress = "0x85DEc42e6b0C23DfaFBA18EAfd0E4A75d4B889dD"; // Aave-only vault (deployed 2026-06-13)

async function main() {
    const { tools, agentKit } = await initializeAgentWallet(vaultAddress);
    
    console.log("AgentKit loaded! Triggering rebalance action directly to test.");
    
    console.log("Available tools:", tools.map((t: any) => t.name));
    
    // find the custom rebalance tool
    const rebalanceTool = tools.find((t: any) => t.name === "VaultActionProvider_rebalance_vault");
    
    if (!rebalanceTool) {
        console.error("Tool not found!");
        return;
    }

    try {
        const result = await rebalanceTool.invoke({});
        console.log("Result:", result);
    } catch (error) {
        console.error("Error invoking tool:", error);
    }
}

main().catch(console.error);
