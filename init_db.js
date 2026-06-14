const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'swarm_responses.db');

// Check if the database already exists with data
if (fs.existsSync(DB_PATH)) {
    const stats = fs.statSync(DB_PATH);
    if (stats.size > 0) {
        console.log(`[HSwarm] Database already exists (${Math.round(stats.size / 1024 / 1024)}MB). Skipping init.`);
        process.exit(0);
    }
}

console.log("[HSwarm] No database found. Creating fresh database structure...");

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`CREATE TABLE IF NOT EXISTS valid_agents (network TEXT NOT NULL, agent_id TEXT NOT NULL, agent_name TEXT NOT NULL, endpoint TEXT NOT NULL, discovery_keyword TEXT NOT NULL DEFAULT '', has_mcp INTEGER NOT NULL DEFAULT 0, is_free INTEGER NOT NULL DEFAULT 0, winning_variant TEXT NOT NULL DEFAULT '', available_tools TEXT NOT NULL DEFAULT '[]', response_time_ms INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL DEFAULT (datetime('now')), last_audited TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (network, agent_id));`);
db.exec(`CREATE TABLE IF NOT EXISTS failed_agents (network TEXT NOT NULL, agent_id TEXT NOT NULL, agent_name TEXT NOT NULL, endpoint TEXT NOT NULL, discovery_keyword TEXT NOT NULL DEFAULT '', has_mcp INTEGER NOT NULL DEFAULT 0, is_free INTEGER NOT NULL DEFAULT 0, failure_category TEXT NOT NULL, raw_error TEXT NOT NULL, first_seen TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (network, agent_id));`);
db.exec(`CREATE TABLE IF NOT EXISTS agent_tasks (network TEXT NOT NULL, agent_id TEXT NOT NULL, agent_name TEXT NOT NULL, endpoint TEXT NOT NULL, discovery_keyword TEXT NOT NULL DEFAULT '', has_mcp INTEGER NOT NULL DEFAULT 0, is_free INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'PENDING', raw_response TEXT, standardized_json TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (network, agent_id));`);
db.exec(`CREATE TABLE IF NOT EXISTS agent_metadata_cache (network TEXT NOT NULL, agent_id TEXT NOT NULL, agent_uri TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Unknown', x402Support INTEGER NOT NULL DEFAULT 0, has_mcp INTEGER NOT NULL DEFAULT 0, is_free INTEGER NOT NULL DEFAULT 0, rawMetadata TEXT, last_synced TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (network, agent_id));`);
db.exec(`CREATE TABLE IF NOT EXISTS agentic_products (product_id TEXT PRIMARY KEY, swarm_id TEXT NOT NULL, purpose TEXT NOT NULL, market_summary TEXT NOT NULL, blueprint_json TEXT NOT NULL, contract_address TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
db.exec(`CREATE TABLE IF NOT EXISTS swarms (swarm_id TEXT PRIMARY KEY, purpose TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', config_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
db.exec(`CREATE TABLE IF NOT EXISTS swarm_weights (swarm_id TEXT NOT NULL, network TEXT NOT NULL, agent_id TEXT NOT NULL, agent_name TEXT NOT NULL DEFAULT '', weight REAL NOT NULL DEFAULT 0, iterations INTEGER NOT NULL DEFAULT 0, cumulative_pnl REAL NOT NULL DEFAULT 0, eliminated INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (swarm_id, network, agent_id));`);

db.close();
console.log("[HSwarm] Fresh database initialized successfully.");
