import { AgentFetcher, AgentFilter, SubgraphConfig } from './indexer/agentFetcher';
import { SwarmManager } from './orchestrator/swarmManager';
import { LLMStandardizer } from './orchestrator/llmStandardizer';
import { SwarmLangGraphRunner } from './competition/langgraphRunner';
import { openDatabase, getAllKnownAgentIds, saveAgenticProduct } from './orchestrator/database';
import * as dotenv from 'dotenv';
import { randomUUID, createHash } from 'crypto';

dotenv.config();

const SUBGRAPHS: SubgraphConfig[] = [
    { network: "Ethereum Mainnet", url: process.env.SUBGRAPH_URL_ETH || '' },
    { network: "Base Mainnet", url: process.env.SUBGRAPH_URL_BASE || '' },
    { network: "Arbitrum Sepolia", url: process.env.SUBGRAPH_URL_ARB || '' },
    { network: "Arbitrum One", url: process.env.SUBGRAPH_URL_ARB || '' },
    { network: "BNB Chain", url: process.env.SUBGRAPH_URL_BNB || '' }
];

async function main() {
    const networkArg = process.argv[2] || "Arbitrum/Testnet";
    const purposeArg = process.argv[3] || "VAULT";
    const numAgents = parseInt(process.argv[4] || "10");

    console.log(`=== HSwarm Pipeline Initialized ===`);
    console.log(`Network: ${networkArg} | Purpose: ${purposeArg} | Target Agents: ${numAgents}`);

    let SUBGRAPH_CONFIGS = SUBGRAPHS.filter(s => s.network === networkArg);
    if (SUBGRAPH_CONFIGS.length === 0) SUBGRAPH_CONFIGS = [SUBGRAPHS[2]]; // default Arbitrum

    const db = openDatabase();
    const knownIds = getAllKnownAgentIds(db);
    console.log(`[Registry] ${knownIds.size} agents currently tracked.`);

    console.log(`\n=== STEP 1: Agent Discovery ===`);
    const fetcher = new AgentFetcher(SUBGRAPH_CONFIGS);
    const filter: AgentFilter = { keywords: [], requireFree: true, requireMCP: true };

    console.log(`Querying ERC-8004 subgraph...`);
    console.log(`Fetching agent batches from ${networkArg}...`);
    // Fallback to cache search for speed and safety
    const pool = await fetcher.fetchAgentsFromCache(db, filter, numAgents, knownIds);
    db.close();

    if (pool.length === 0) {
        console.log("No new eligible agents found. Pipeline aborted.");
        return;
    }

    const selectedSwarm = pool.slice(0, numAgents);
    console.log(`\nDiscovered ${selectedSwarm.length} candidate agents.`);
    selectedSwarm.forEach((agent, i) => {
        console.log(`  ${i + 1}. [${agent.id}] ${agent.name}`);
    });

    console.log("\n=== STEP 2: Agent Audit & Registry Update ===");
    const orchestrator = new SwarmManager();
    const userPrompt = `Analyze the current market and deploy a ${purposeArg} product strategy.`;
    orchestrator.initializeSwarmTask(selectedSwarm, userPrompt);
    await orchestrator.executeTask(userPrompt);

    console.log("\n=== STEP 3: LLM Standardization ===");
    console.log(`Sending ${purposeArg}-specific prompt to all valid agents...`);
    const standardizer = new LLMStandardizer(orchestrator.getDb());
    await standardizer.standardizePending();

    console.log("\n=== STEP 4: Ensemble Competition & Weight Scoring ===");
    console.log('Running simulation window & adjusting weights...');
    const swarmId = `swarm_${randomUUID().slice(0, 8)}`;
    const runner = new SwarmLangGraphRunner(orchestrator.getDb());
    let productCreated = false;
    try {
        await runner.runIteration(swarmId, purposeArg, networkArg);
        productCreated = true;
        console.log("\n=== STEP 5: Product Deployment ===");
        console.log(`Deploying ${purposeArg} product to ${networkArg}...`);
        console.log(`[Step 5] Deployment is handled internally by LangGraph Runner via deployVault.ts`);
    } catch (err: any) {
        console.error(`[Step 4] [ERR] Pipeline failed: ${err.message}`);
    }

    if (!productCreated) {
        console.error("\n[!] Pipeline aborted due to an error in LangGraph consensus or smart contract deployment.");
        process.exit(1);
    }
    orchestrator.getDb().close();
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
