import { initializeAgentWallet } from "./src/executor/walletAgent";

async function main() {
    console.log("Initializing Agent to test Chainlink Upkeep registration...");
    
    // We will use the last deployed Sepolia vault
    const vaultAddress = "0xCE5fFde0Fb93F7101144519F6A090858220186Aa";
    const vaultName = "Balanced USDC Yield Optimizer (Test)";

    try {
        const agentData = await initializeAgentWallet(vaultAddress);
        const chainlinkTool = agentData.tools.find((t: any) => t.name === "ChainlinkActionProvider_register_chainlink_upkeep");
        
        if (!chainlinkTool) {
            console.error("Tool 'ChainlinkActionProvider_register_chainlink_upkeep' not found.");
            return;
        }

        console.log(`Executing tool to register upkeep for vault ${vaultAddress}...`);
        const result = await chainlinkTool.invoke({ 
            vaultAddress, 
            vaultName 
        });
        
        console.log("\n================ RESULT ================");
        console.log(result);
        console.log("========================================");
    } catch (err) {
        console.error("Test failed:", err);
    }
}

main().catch(console.error);
