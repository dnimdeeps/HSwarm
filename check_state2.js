const Database = require('better-sqlite3');
const db = new Database('swarm_responses.db');

console.log('\n=== VAULTS WITH CONTRACTS ===');
const products = db.prepare("SELECT product_id, purpose, contract_address, created_at FROM agentic_products WHERE contract_address IS NOT NULL ORDER BY created_at DESC").all();
console.log(`Total deployed vaults: ${products.length}`);
products.forEach(p => console.log(`  ${p.product_id} | ${p.contract_address} | ${p.created_at}`));

console.log('\n=== VALID AGENTS ===');
const agents = db.prepare("SELECT agent_id, agent_name, available_tools FROM valid_agents LIMIT 10").all();
console.log(`Total valid agents: ${agents.length}`);
agents.forEach(a => console.log(`  ${a.agent_id} - ${a.agent_name} | tools: ${a.available_tools}`));

console.log('\n=== AGENT TASKS STATS ===');
const stats = db.prepare("SELECT status, count(*) as cnt FROM agent_tasks GROUP BY status").all();
stats.forEach(s => console.log(`  ${s.status}: ${s.cnt}`));

db.close();
