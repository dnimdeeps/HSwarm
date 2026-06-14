const Database = require('better-sqlite3');
const db = new Database('swarm_responses.db');

console.log('\n=== AGENTIC PRODUCTS ===');
const products = db.prepare("SELECT product_id, purpose, contract_address, blueprint_json, created_at FROM agentic_products ORDER BY created_at DESC").all();
products.forEach(p => {
  const bp = JSON.parse(p.blueprint_json || '{}');
  console.log(`[${p.purpose}] ${p.product_id} | contract: ${p.contract_address || 'NONE'} | strategy: ${bp.strategy_name || '?'} | created: ${p.created_at}`);
});

console.log('\n=== VALID AGENTS ===');
const agents = db.prepare("SELECT agent_id, agent_name, available_tools, response_time_ms FROM valid_agents LIMIT 10").all();
agents.forEach(a => console.log(`  ${a.agent_id} - ${a.agent_name} | tools: ${a.available_tools} | ${a.response_time_ms}ms`));

console.log('\n=== SWARMS ===');
const swarms = db.prepare("SELECT swarm_id, purpose, created_at FROM swarms ORDER BY created_at DESC LIMIT 5").all();
swarms.forEach(s => console.log(`  ${s.swarm_id} | ${s.purpose} | ${s.created_at}`));

db.close();
