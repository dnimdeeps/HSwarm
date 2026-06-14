import * as dotenv from 'dotenv';
import { AgentFetcher, AgentFilter, SubgraphConfig } from './src/indexer/agentFetcher';
import { SwarmManager } from './src/orchestrator/swarmManager';
import { LLMStandardizer } from './src/orchestrator/llmStandardizer';
import { SwarmLangGraphRunner } from './src/competition/langgraphRunner';
import { ProductBuilder } from './src/executor/productBuilder';
import { openDatabase, getAllKnownAgentIds, getRegistrySummary } from './src/orchestrator/database';
import { randomUUID } from 'crypto';

dotenv.config();

const SUBGRAPHS: SubgraphConfig[] = [
    { network: "Ethereum Mainnet", url: process.env.SUBGRAPH_URL_ETH || '' },
    { network: "Base Mainnet", url: process.env.SUBGRAPH_URL_BASE || '' },
    { network: "Arbitrum/Testnet", url: process.env.SUBGRAPH_URL_ARB || '' },
    { network: "BNB Chain", url: process.env.SUBGRAPH_URL_BNB || '' }
];

async function main() {
    console.log("=== AUTO RUN: HSwarm Pipeline ===\n");

    const db = openDatabase();
    const knownIds = getAllKnownAgentIds(db);
    db.close();

    console.log(`\n=== STEP 1: Agent Discovery (Cache Mode) ===`);
    const fetcher = new AgentFetcher(SUBGRAPHS);
    const filter: AgentFilter = {
        keywords:    [],
        requireFree: true,
        requireMCP:  true,
    };

    const swarmSize = 10;
    const dbForSearch = openDatabase();
    const pool = await fetcher.fetchAgentsFromCache(dbForSearch, filter, swarmSize, knownIds);
    dbForSearch.close();

    if (pool.length === 0) {
        console.log("No new agents found in cache. Exiting.");
        return;
    }

    const selectedSwarm = pool.slice(0, swarmSize);
    console.log(`Selected ${selectedSwarm.length} agents for execution.`);

    console.log("\n=== STEP 2: Agent Audit & Registry Update ===");
    const orchestrator = new SwarmManager();
    const userPrompt = "Analyze the ETH/USDC perpetual market and execute a scalp strategy";
    orchestrator.initializeSwarmTask(selectedSwarm, userPrompt);
    await orchestrator.executeTask(userPrompt);

    console.log("\n=== STEP 3: LLM Standardization ===");
    const standardizer = new LLMStandardizer(orchestrator.getDb());
    await standardizer.standardizePending();
    orchestrator.printDatabase();

    console.log("\n=== STEP 4: LangGraph ===");
    const purpose = process.argv[2]?.toUpperCase() || "VAULT";
    console.log(`Executing LangGraph with Purpose: ${purpose}`);
    
    const swarmId = `swarm_${randomUUID().slice(0, 8)}`;
    const runner = new SwarmLangGraphRunner(orchestrator.getDb());
    try {
        await runner.runIteration(swarmId, purpose);
    } catch (err: any) {
        console.error(`\n[Step 4] Failed: ${err.message}`);
    }

    console.log("\n=== STEP 5: Product Creation ===");
    const builder = new ProductBuilder(orchestrator.getDb());
    builder.buildLatestProduct();

    orchestrator.getDb().close();
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
