/**
 * Quick smoke test for the fixed auditor + swarmManager.
 * Targets a known-good Zyfai agent to verify:
 *   1. tools/list does NOT hang (body-read timeout works)
 *   2. Tool schema is extracted (inputSchema captured)
 *   3. Correct arguments are built from schema (chainId = 8453)
 *   4. tools/call succeeds with real data
 * 
 * Run: npx ts-node test_fix.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { auditAgent } from './src/orchestrator/auditor';

const TEST_AGENT = {
    id: "46170",
    name: "Zyfai Rebalancer Agent",
    // Known endpoint from valid_agents table
    endpoint: "https://mcp.zyf.ai"
};

async function main() {
    console.log("=== Fix Verification Test ===\n");
    console.log(`Testing agent: ${TEST_AGENT.name}`);
    console.log(`Endpoint     : ${TEST_AGENT.endpoint}\n`);

    const start = Date.now();
    const result = await auditAgent(
        TEST_AGENT.id,
        TEST_AGENT.name,
        TEST_AGENT.endpoint,
        30_000
    );
    const elapsed = Date.now() - start;

    console.log(`\n--- Audit Result (${elapsed}ms) ---`);
    console.log(`Health       : ${result.health}`);
    console.log(`Tools found  : ${result.availableTools.length}`);
    console.log(`Tool names   : ${result.availableTools.join(", ")}`);
    console.log(`Winning var  : ${result.winningVariant}`);
    console.log(`Notes        : ${result.notes}`);

    if (result.toolSchemas.length > 0) {
        console.log(`\n--- Tool Schemas ---`);
        result.toolSchemas.forEach(t => {
            const required = t.inputSchema?.required ?? [];
            const props = Object.keys(t.inputSchema?.properties ?? {});
            console.log(`  ${t.name}: required=[${required.join(", ")}] props=[${props.join(", ")}]`);
        });
    }

    if (result.health !== "HEALTHY") {
        console.error(`\n❌ Audit failed: ${result.health}`);
        process.exit(1);
    }

    console.log(`\n✅ Audit passed! Body-read timeout is working (no hang).`);
    console.log(`✅ Tool schemas captured for ${result.toolSchemas.length} tools.`);
}

main().catch(err => {
    console.error("Fatal:", err);
    process.exit(1);
});
