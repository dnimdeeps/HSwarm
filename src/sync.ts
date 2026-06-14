import { AgentFetcher, SubgraphConfig } from './indexer/agentFetcher';
import { openDatabase } from './orchestrator/database';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config();

const SUBGRAPHS: SubgraphConfig[] = [
    { network: "Ethereum Mainnet", url: process.env.SUBGRAPH_URL_ETH || '' },
    { network: "Base Mainnet", url: process.env.SUBGRAPH_URL_BASE || '' },
    { network: "Arbitrum/Testnet", url: process.env.SUBGRAPH_URL_ARB || '' },
    { network: "BNB Chain", url: process.env.SUBGRAPH_URL_BNB || '' }
];

function askQuestion(query: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans.trim());
    }));
}

async function main() {
    console.log("=== HSwarm — Agent Cache Synchronization ===\n");
    console.log("Select Target Network to Sync:");
    console.log("  [1] Ethereum Mainnet");
    console.log("  [2] Base Mainnet");
    console.log("  [3] Arbitrum/Testnet");
    console.log("  [4] BNB Chain");
    console.log("  [5] All of the above (Sequential Sync)");
    
    const choice = await askQuestion("Enter your choice (1-5): ");
    let SUBGRAPH_CONFIGS: SubgraphConfig[] = [];
    if (choice === '1') SUBGRAPH_CONFIGS = [SUBGRAPHS[0]];
    else if (choice === '2') SUBGRAPH_CONFIGS = [SUBGRAPHS[1]];
    else if (choice === '3') SUBGRAPH_CONFIGS = [SUBGRAPHS[2]];
    else if (choice === '4') SUBGRAPH_CONFIGS = [SUBGRAPHS[3]];
    else if (choice === '5') SUBGRAPH_CONFIGS = SUBGRAPHS;
    else {
        console.log("Invalid choice. Exiting...");
        return;
    }

    if (!SUBGRAPH_CONFIGS[0].url) {
        console.log(`Error: Missing subgraph URL for ${SUBGRAPH_CONFIGS[0].network} in .env file!`);
        return;
    }

    console.log(`\nStarting Cache Sync for: ${SUBGRAPH_CONFIGS.map(c => c.network).join(', ')}`);
    console.log("This will download IPFS metadata into your local SQLite database.");

    const fetcher = new AgentFetcher(SUBGRAPH_CONFIGS);
    const db = openDatabase();

    await fetcher.buildCache(db);
    
    db.close();
    console.log("\n✅ Cache sync complete. You can now use the Cache-Based search in index.ts.");
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
