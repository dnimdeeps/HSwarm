/**
 * migrate.js
 *
 * One-time migration script — run with: node migrate.js
 *
 * Moves the existing 50-agent run from the old tables into the new schema:
 *   agent_tasks  WHERE status = 'PARSING_LLM'  →  valid_agents
 *   agent_failures                              →  failed_agents
 *
 * Safe to run multiple times (all inserts are ON CONFLICT DO NOTHING).
 * The old tables are left intact; the new tables are created if they don't exist.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'swarm_responses.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ── Create the new persistent tables if they don't exist yet ──────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS valid_agents (
        agent_id         TEXT PRIMARY KEY,
        agent_name       TEXT NOT NULL,
        endpoint         TEXT NOT NULL,
        winning_variant  TEXT NOT NULL DEFAULT '',
        available_tools  TEXT NOT NULL DEFAULT '[]',
        response_time_ms INTEGER NOT NULL DEFAULT 0,
        first_seen       TEXT NOT NULL DEFAULT (datetime('now')),
        last_audited     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS failed_agents (
        agent_id         TEXT PRIMARY KEY,
        agent_name       TEXT NOT NULL,
        endpoint         TEXT NOT NULL,
        failure_category TEXT NOT NULL,
        raw_error        TEXT NOT NULL,
        first_seen       TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

// ── Migrate valid agents (PARSING_LLM = passed the 16-variant probe) ─────────
const validRows = db.prepare(`
    SELECT agent_id, agent_name, endpoint, created_at
    FROM agent_tasks
    WHERE status = 'PARSING_LLM'
`).all();

const insertValid = db.prepare(`
    INSERT INTO valid_agents (agent_id, agent_name, endpoint, winning_variant, available_tools, response_time_ms, first_seen, last_audited)
    VALUES (@agent_id, @agent_name, @endpoint, @winning_variant, @available_tools, @response_time_ms, @first_seen, @last_audited)
    ON CONFLICT(agent_id) DO NOTHING
`);

let migratedValid = 0;
for (const row of validRows) {
    insertValid.run({
        agent_id:         row.agent_id,
        agent_name:       row.agent_name,
        endpoint:         row.endpoint,
        winning_variant:  '(migrated from run 1 — variant unknown)',
        available_tools:  '[]',
        response_time_ms: 0,
        first_seen:       row.created_at,
        last_audited:     row.created_at,
    });
    migratedValid++;
}

// ── Migrate failed agents ─────────────────────────────────────────────────────
const failedRows = db.prepare(`
    SELECT agent_id, agent_name, endpoint, category, raw_error, created_at
    FROM agent_failures
`).all();

const insertFailed = db.prepare(`
    INSERT INTO failed_agents (agent_id, agent_name, endpoint, failure_category, raw_error, first_seen)
    VALUES (@agent_id, @agent_name, @endpoint, @failure_category, @raw_error, @first_seen)
    ON CONFLICT(agent_id) DO NOTHING
`);

let migratedFailed = 0;
for (const row of failedRows) {
    insertFailed.run({
        agent_id:         row.agent_id,
        agent_name:       row.agent_name,
        endpoint:         row.endpoint,
        failure_category: row.category,
        raw_error:        row.raw_error,
        first_seen:       row.created_at,
    });
    migratedFailed++;
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n✅ Migration complete!`);
console.log(`   → valid_agents  : ${migratedValid} agents migrated`);
console.log(`   → failed_agents : ${migratedFailed} agents migrated`);
console.log(`   → Total audited : ${migratedValid + migratedFailed}`);
console.log(`\nThe old agent_tasks and agent_failures tables are untouched.`);
console.log(`You can drop them later with: DROP TABLE agent_tasks; DROP TABLE agent_failures;`);

db.close();
