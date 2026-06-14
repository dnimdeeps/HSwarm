import { AgentFetcher, AgentFilter, SubgraphConfig } from './indexer/agentFetcher';
import { SwarmManager } from './orchestrator/swarmManager';
import { LLMStandardizer } from './orchestrator/llmStandardizer';
import { SwarmLangGraphRunner } from './competition/langgraphRunner';
import { openDatabase, getAllKnownAgentIds, getRegistrySummary } from './orchestrator/database';
import * as dotenv from 'dotenv';
import * as readline from 'readline';
import { randomUUID } from 'crypto';

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

function askConfirmation(query: string): Promise<boolean> {
    return askQuestion(query).then(ans => ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes');
}

async function main() {
    console.log("=== HSwarm — Agent Registry Builder ===\n");
    console.log("Select Target Network to scan:");
    console.log("  [1] Ethereum Mainnet");
    console.log("  [2] Base Mainnet");
    console.log("  [3] Arbitrum/Testnet");
    console.log("  [4] BNB Chain");
    console.log("  [5] All of the above (Sequential)");
    
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

    const db = openDatabase();
    const registry = getRegistrySummary(db);
    console.log(`[Registry] Current state:`);
    console.log(`  valid_agents  : ${registry.valid}`);
    console.log(`  failed_agents : ${registry.failed}`);
    console.log(`  total audited : ${registry.total}`);

    const knownIds = getAllKnownAgentIds(db);
    console.log(`\n[Registry] ${knownIds.size} agents will be skipped (already audited).`);
    db.close();

    console.log(`\n=== STEP 1: Agent Discovery ===`);
    console.log(`Networks configured: ${SUBGRAPH_CONFIGS.map(c => c.network).join(', ')}`);

    console.log("\nSelect Discovery Method:");
    console.log("  [1] Live Decentralized Search (Real-time IPFS fetching)");
    console.log("  [2] Cache-Based Search (Instant SQL search from local database)");
    const modeChoice = await askQuestion("Enter your choice (1-2): ");

    const fetcher = new AgentFetcher(SUBGRAPH_CONFIGS);

    const filter: AgentFilter = {
        keywords:    [],          // e.g., ["trading", "perpetual", "defi"]
        requireFree: true,       // Set to true if you only want free agents
        requireMCP:  true,        // Must have an MCP endpoint
    };

    const swarmSize = 10;
    let pool: any[] = [];

    if (modeChoice === '2') {
        const dbForSearch = openDatabase();
        pool = await fetcher.fetchAgentsFromCache(dbForSearch, filter, swarmSize, knownIds);
        dbForSearch.close();
    } else {
        pool = await fetcher.fetchAgentsByFilter(filter, swarmSize, knownIds);
    }

    if (pool.length === 0) {
        console.log("\n✅ No agents found or all scanned agents are already audited! Run again to discover more.");
        return;
    }

    if (swarmSize > pool.length) {
        console.log(`\n⚠️  Requested ${swarmSize} agents but only ${pool.length} unaudited agents match. Using all ${pool.length}.`);
    } else {
        console.log(`\nSelecting ${swarmSize} agents at random for this run...`);
    }

    // We don't need to selectRandomAgents here again since fetchAgentsByFilter/fetchAgentsFromCache already limits and shuffles
    const selectedSwarm = pool.slice(0, swarmSize);

    console.log("\n=== Step 1 Complete: Selected Swarm ===");
    selectedSwarm.forEach((agent, i) => {
        console.log(`  ${i + 1}. [${agent.id}] ${agent.name}`);
    });

    // ── INTERACTIVE CONFIRMATION ───────────────────────────────────────────
    const shouldContinue = await askConfirmation(`\nFound ${selectedSwarm.length} agents. Do you want to continue with Step 2 (Verification)? (y/n): `);
    if (!shouldContinue) {
        console.log("Operation cancelled by user. Exiting...");
        return;
    }

    // ── STEP 2: Audit & Store ──────────────────────────────────────────────
    console.log("\n\n=== STEP 2: Agent Audit & Registry Update ===");

    const orchestrator = new SwarmManager();

    const userPrompt = "Analyze the ETH/USDC perpetual market and execute a scalp strategy";
    orchestrator.initializeSwarmTask(selectedSwarm, userPrompt);

    await orchestrator.executeTask(userPrompt);

    // ── STEP 3: LLM Standardization ────────────────────────────────────────
    const standardizer = new LLMStandardizer(orchestrator.getDb());
    await standardizer.standardizePending();

    orchestrator.printDatabase();

    // ── STEP 4: Ensemble Competition & Weight Scoring ───────────────────────
    const runStep4 = await askConfirmation("\nRun Step 4 (Ensemble competition & weight scoring)? (y/n): ");
    if (!runStep4) {
        console.log("Skipping Step 4. Exiting...");
        orchestrator.getDb().close();
        return;
    }

    const swarmId = `swarm_${randomUUID().slice(0, 8)}`;
    const runner = new SwarmLangGraphRunner(orchestrator.getDb());

    try {
        await runner.runIteration(swarmId);
    } catch (err: any) {
        console.error(`\n[Step 4] Failed: ${err.message}`);
    }

    orchestrator.getDb().close();
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
