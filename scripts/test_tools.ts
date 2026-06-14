import { initializeAgentWallet } from "./src/executor/walletAgent";

async function main() {
    const agentData = await initializeAgentWallet();
    console.log("Tools available:");
    for (const tool of agentData.tools) {
        console.log(tool.name);
    }
}

main().catch(console.error);
