/**
 * database.ts
 * Persistent SQLite registry for the HSwarm agent audit pipeline.
 *
 * Table model:
 *   valid_agents   — PERSISTENT. Agents that passed the 16-variant MCP probe.
 *   failed_agents  — PERSISTENT. Agents that failed all 16 variants.
 *   agent_tasks    — EPHEMERAL. Tracks per-run state.
 */

import Database from 'better-sqlite3';
import path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus =
    | "PENDING"
    | "FETCHING_AGENT"
    | "PARSING_LLM"
    | "COMPLETED"
    | "FAILED"
    | "TIMEOUT";

export interface AgentTaskRow {
    network: string;
    agent_id: string;
    agent_name: string;
    endpoint: string;
    discovery_keyword: string;
    has_mcp: number;
    is_free: number;
    status: TaskStatus;
    raw_response: string | null;
    standardized_json: string | null;
    error: string | null;
    created_at: string;
    updated_at: string;
}

export interface ValidAgentRow {
    network: string;
    agent_id: string;
    agent_name: string;
    endpoint: string;
    discovery_keyword: string;
    has_mcp: number;
    is_free: number;
    winning_variant: string;
    available_tools: string;
    response_time_ms: number;
    first_seen: string;
    last_audited: string;
}

export interface FailedAgentRow {
    network: string;
    agent_id: string;
    agent_name: string;
    endpoint: string;
    discovery_keyword: string;
    has_mcp: number;
    is_free: number;
    failure_category: string;
    raw_error: string;
    first_seen: string;
}

const DB_PATH = path.join(process.cwd(), 'swarm_responses.db');

// ─── Open & initialize ────────────────────────────────────────────────────────

export function openDatabase(): Database.Database {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    db.exec(`
        CREATE TABLE IF NOT EXISTS valid_agents (
            network          TEXT NOT NULL,
            agent_id         TEXT NOT NULL,
            agent_name       TEXT NOT NULL,
            endpoint         TEXT NOT NULL,
            discovery_keyword TEXT NOT NULL DEFAULT '',
            has_mcp          INTEGER NOT NULL DEFAULT 0,
            is_free          INTEGER NOT NULL DEFAULT 0,
            winning_variant  TEXT NOT NULL DEFAULT '',
            available_tools  TEXT NOT NULL DEFAULT '[]',
            response_time_ms INTEGER NOT NULL DEFAULT 0,
            first_seen       TEXT NOT NULL DEFAULT (datetime('now')),
            last_audited     TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (network, agent_id)
        );

        CREATE TABLE IF NOT EXISTS failed_agents (
            network          TEXT NOT NULL,
            agent_id         TEXT NOT NULL,
            agent_name       TEXT NOT NULL,
            endpoint         TEXT NOT NULL,
            discovery_keyword TEXT NOT NULL DEFAULT '',
            has_mcp          INTEGER NOT NULL DEFAULT 0,
            is_free          INTEGER NOT NULL DEFAULT 0,
            failure_category TEXT NOT NULL,
            raw_error        TEXT NOT NULL,
            first_seen       TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (network, agent_id)
        );

        CREATE TABLE IF NOT EXISTS agent_tasks (
            network          TEXT NOT NULL,
            agent_id         TEXT NOT NULL,
            agent_name       TEXT NOT NULL,
            endpoint         TEXT NOT NULL,
            discovery_keyword TEXT NOT NULL DEFAULT '',
            has_mcp          INTEGER NOT NULL DEFAULT 0,
            is_free          INTEGER NOT NULL DEFAULT 0,
            status           TEXT NOT NULL DEFAULT 'PENDING',
            raw_response     TEXT,
            standardized_json TEXT,
            error            TEXT,
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (network, agent_id)
        );

        CREATE TABLE IF NOT EXISTS agent_metadata_cache (
            network          TEXT NOT NULL,
            agent_id         TEXT NOT NULL,
            agent_uri        TEXT NOT NULL,
            name             TEXT NOT NULL DEFAULT '',
            description      TEXT NOT NULL DEFAULT '',
            status           TEXT NOT NULL DEFAULT 'Unknown',
            x402Support      INTEGER NOT NULL DEFAULT 0,
            has_mcp          INTEGER NOT NULL DEFAULT 0,
            is_free          INTEGER NOT NULL DEFAULT 0,
            rawMetadata      TEXT,
            last_synced      TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (network, agent_id)
        );

        CREATE TABLE IF NOT EXISTS swarms (
            swarm_id     TEXT PRIMARY KEY,
            purpose      TEXT NOT NULL,
            status       TEXT NOT NULL DEFAULT 'ACTIVE',
            config_json  TEXT NOT NULL,
            created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS agentic_products (
            product_id       TEXT PRIMARY KEY,
            swarm_id         TEXT NOT NULL,
            purpose          TEXT NOT NULL,
            market_summary   TEXT NOT NULL,
            blueprint_json   TEXT NOT NULL,
            contract_address TEXT,
            created_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS swarm_weights (
            swarm_id       TEXT NOT NULL,
            network        TEXT NOT NULL,
            agent_id       TEXT NOT NULL,
            agent_name     TEXT NOT NULL DEFAULT '',
            weight         REAL NOT NULL DEFAULT 0,
            iterations     INTEGER NOT NULL DEFAULT 0,
            cumulative_pnl REAL NOT NULL DEFAULT 0,
            eliminated     INTEGER NOT NULL DEFAULT 0,
            updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (swarm_id, network, agent_id)
        );

        CREATE TABLE IF NOT EXISTS competition_iterations (
            iteration_id        TEXT PRIMARY KEY,
            swarm_id            TEXT NOT NULL,
            purpose             TEXT NOT NULL,
            evaluated_at        TEXT NOT NULL DEFAULT (datetime('now')),
            window_ms           INTEGER NOT NULL,
            oracle_source       TEXT NOT NULL,
            agents_scored       INTEGER NOT NULL,
            agents_total        INTEGER NOT NULL,
            ensemble_action     TEXT,
            ensemble_confidence REAL,
            ensemble_return_pct REAL,
            ensemble_json       TEXT
        );

        CREATE TABLE IF NOT EXISTS iteration_results (
            iteration_id       TEXT NOT NULL,
            network            TEXT NOT NULL,
            agent_id           TEXT NOT NULL,
            agent_name         TEXT NOT NULL DEFAULT '',
            standardized_json  TEXT NOT NULL,
            action             TEXT NOT NULL,
            raw_return_pct     REAL NOT NULL DEFAULT 0,
            pnl_usd            REAL NOT NULL DEFAULT 0,
            weight_before      REAL NOT NULL,
            weight_after       REAL NOT NULL,
            scored             INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (iteration_id, network, agent_id)
        );
    `);

    return db;
}

// ─── Ephemeral: agent_tasks ───────────────────────────────────────────────────

export function clearRunTasks(db: Database.Database) {
    db.exec(`DELETE FROM agent_tasks;`);
}

export function upsertAgentTask(db: Database.Database, row: Partial<AgentTaskRow> & { network: string, agent_id: string }) {
    const stmt = db.prepare(`
        INSERT INTO agent_tasks (network, agent_id, agent_name, endpoint, discovery_keyword, has_mcp, is_free, status, raw_response, standardized_json, error, updated_at)
        VALUES (@network, @agent_id, @agent_name, @endpoint, @discovery_keyword, @has_mcp, @is_free, @status, @raw_response, @standardized_json, @error, datetime('now'))
        ON CONFLICT(network, agent_id) DO UPDATE SET
            status            = excluded.status,
            raw_response      = COALESCE(excluded.raw_response, raw_response),
            standardized_json = COALESCE(excluded.standardized_json, standardized_json),
            error             = COALESCE(excluded.error, error),
            updated_at        = datetime('now')
    `);
    stmt.run({
        network:           row.network,
        agent_id:          row.agent_id,
        agent_name:        row.agent_name ?? null,
        endpoint:          row.endpoint ?? null,
        discovery_keyword: row.discovery_keyword ?? '',
        has_mcp:           row.has_mcp ?? 0,
        is_free:           row.is_free ?? 0,
        status:            row.status ?? "PENDING",
        raw_response:      row.raw_response ?? null,
        standardized_json: row.standardized_json ?? null,
        error:             row.error ?? null,
    });
}

export function getTaskSummary(db: Database.Database) {
    return db.prepare(`SELECT status, COUNT(*) as count FROM agent_tasks GROUP BY status`).all() as { status: TaskStatus; count: number }[];
}

export function getPendingForLLM(db: Database.Database): AgentTaskRow[] {
    return db.prepare(`SELECT * FROM agent_tasks WHERE status = 'PARSING_LLM' AND raw_response IS NOT NULL`).all() as AgentTaskRow[];
}

export function getCompletedTasks(db: Database.Database): AgentTaskRow[] {
    return db.prepare(`
        SELECT * FROM agent_tasks
        WHERE status = 'COMPLETED' AND standardized_json IS NOT NULL
    `).all() as AgentTaskRow[];
}

// ─── Persistent: valid_agents ─────────────────────────────────────────────────

export function upsertValidAgent(
    db: Database.Database,
    network: string,
    agent_id: string,
    agent_name: string,
    endpoint: string,
    discovery_keyword: string,
    has_mcp: number,
    is_free: number,
    winning_variant: string,
    available_tools: string[],
    response_time_ms: number
) {
    db.prepare(`
        INSERT INTO valid_agents (network, agent_id, agent_name, endpoint, discovery_keyword, has_mcp, is_free, winning_variant, available_tools, response_time_ms, first_seen, last_audited)
        VALUES (@network, @agent_id, @agent_name, @endpoint, @discovery_keyword, @has_mcp, @is_free, @winning_variant, @available_tools, @response_time_ms, datetime('now'), datetime('now'))
        ON CONFLICT(network, agent_id) DO UPDATE SET
            agent_name       = excluded.agent_name,
            endpoint         = excluded.endpoint,
            winning_variant  = excluded.winning_variant,
            available_tools  = excluded.available_tools,
            response_time_ms = excluded.response_time_ms,
            last_audited     = datetime('now')
    `).run({
        network,
        agent_id,
        agent_name,
        endpoint,
        discovery_keyword,
        has_mcp,
        is_free,
        winning_variant,
        available_tools: JSON.stringify(available_tools),
        response_time_ms,
    });
}

// ─── Persistent: failed_agents ────────────────────────────────────────────────

export function upsertFailedAgent(
    db: Database.Database,
    network: string,
    agent_id: string,
    agent_name: string,
    endpoint: string,
    discovery_keyword: string,
    has_mcp: number,
    is_free: number,
    failure_category: string,
    raw_error: string
) {
    db.prepare(`
        INSERT INTO failed_agents (network, agent_id, agent_name, endpoint, discovery_keyword, has_mcp, is_free, failure_category, raw_error, first_seen)
        VALUES (@network, @agent_id, @agent_name, @endpoint, @discovery_keyword, @has_mcp, @is_free, @failure_category, @raw_error, datetime('now'))
        ON CONFLICT(network, agent_id) DO UPDATE SET
            failure_category = excluded.failure_category,
            raw_error        = excluded.raw_error
    `).run({ network, agent_id, agent_name, endpoint, discovery_keyword, has_mcp, is_free, failure_category, raw_error });
}

// ─── Registry queries ─────────────────────────────────────────────────────────

/**
 * Returns all composite IDs (network_agentId) already in the persistent tables.
 */
export function getAllKnownAgentIds(db: Database.Database): Set<string> {
    const validIds = db.prepare(`SELECT network, agent_id FROM valid_agents`).all() as { network: string, agent_id: string }[];
    const failedIds = db.prepare(`SELECT network, agent_id FROM failed_agents`).all() as { network: string, agent_id: string }[];
    const all = [...validIds, ...failedIds].map(r => `${r.network}_${r.agent_id}`);
    return new Set(all);
}

export function getRegistrySummary(db: Database.Database) {
    const valid = (db.prepare(`SELECT COUNT(*) as count FROM valid_agents`).get() as any).count as number;
    const failed = (db.prepare(`SELECT COUNT(*) as count FROM failed_agents`).get() as any).count as number;
    const byCategory = db.prepare(`SELECT failure_category, COUNT(*) as count FROM failed_agents GROUP BY failure_category`).all() as { failure_category: string; count: number }[];
    return { valid, failed, total: valid + failed, byCategory };
}

// ─── Persistent: agent_metadata_cache ─────────────────────────────────────────

export interface AgentCacheRow {
    network: string;
    agent_id: string;
    agent_uri: string;
    name: string;
    description: string;
    status: string;
    x402Support: number;
    has_mcp: number;
    is_free: number;
    rawMetadata: string | null;
}

export function upsertAgentCache(db: Database.Database, row: AgentCacheRow) {
    const stmt = db.prepare(`
        INSERT INTO agent_metadata_cache (network, agent_id, agent_uri, name, description, status, x402Support, has_mcp, is_free, rawMetadata, last_synced)
        VALUES (@network, @agent_id, @agent_uri, @name, @description, @status, @x402Support, @has_mcp, @is_free, @rawMetadata, datetime('now'))
        ON CONFLICT(network, agent_id) DO UPDATE SET
            agent_uri    = excluded.agent_uri,
            name         = excluded.name,
            description  = excluded.description,
            status       = excluded.status,
            x402Support  = excluded.x402Support,
            has_mcp      = excluded.has_mcp,
            is_free      = excluded.is_free,
            rawMetadata  = excluded.rawMetadata,
            last_synced  = datetime('now')
    `);
    stmt.run(row);
}

// ─── Ensemble: swarms & weights ───────────────────────────────────────────────

export interface SwarmWeightRow {
    swarm_id: string;
    network: string;
    agent_id: string;
    agent_name: string;
    weight: number;
    iterations: number;
    cumulative_pnl: number;
    eliminated: number;
}

export function upsertSwarm(
    db: Database.Database,
    swarmId: string,
    purpose: string,
    configJson: string
) {
    db.prepare(`
        INSERT INTO swarms (swarm_id, purpose, status, config_json)
        VALUES (@swarm_id, @purpose, 'ACTIVE', @config_json)
        ON CONFLICT(swarm_id) DO UPDATE SET
            purpose     = excluded.purpose,
            config_json = excluded.config_json
    `).run({ swarm_id: swarmId, purpose, config_json: configJson });
}

export function saveAgenticProduct(
    db: Database.Database,
    productId: string,
    swarmId: string,
    purpose: string,
    marketSummary: string,
    blueprintJson: string,
    contractAddress: string | null = null
) {
    db.prepare(`
        INSERT INTO agentic_products (product_id, swarm_id, purpose, market_summary, blueprint_json, contract_address, created_at)
        VALUES (@product_id, @swarm_id, @purpose, @market_summary, @blueprint_json, @contract_address, datetime('now'))
    `).run({
        product_id: productId,
        swarm_id: swarmId,
        purpose: purpose,
        market_summary: marketSummary,
        blueprint_json: blueprintJson,
        contract_address: contractAddress
    });
}

export function updateAgenticProductContractAddress(
    db: Database.Database,
    productId: string,
    contractAddress: string
) {
    db.prepare(`
        UPDATE agentic_products 
        SET contract_address = @contract_address 
        WHERE product_id = @product_id
    `).run({
        contract_address: contractAddress,
        product_id: productId,
    });
}

export function initSwarmWeights(
    db: Database.Database,
    swarmId: string,
    agents: { network: string; agent_id: string; agent_name: string }[]
) {
    if (agents.length === 0) return;
    const equalWeight = 1 / agents.length;
    const stmt = db.prepare(`
        INSERT INTO swarm_weights (swarm_id, network, agent_id, agent_name, weight, iterations, cumulative_pnl, eliminated, updated_at)
        VALUES (@swarm_id, @network, @agent_id, @agent_name, @weight, 0, 0, 0, datetime('now'))
        ON CONFLICT(swarm_id, network, agent_id) DO NOTHING
    `);
    for (const agent of agents) {
        stmt.run({
            swarm_id: swarmId,
            network: agent.network,
            agent_id: agent.agent_id,
            agent_name: agent.agent_name,
            weight: equalWeight,
        });
    }
}

export function getSwarmWeights(db: Database.Database, swarmId: string): SwarmWeightRow[] {
    return db.prepare(`
        SELECT * FROM swarm_weights WHERE swarm_id = ? AND eliminated = 0
    `).all(swarmId) as SwarmWeightRow[];
}

export function getSwarmWeightMap(db: Database.Database, swarmId: string): Map<string, SwarmWeightRow> {
    const rows = db.prepare(`SELECT * FROM swarm_weights WHERE swarm_id = ?`).all(swarmId) as SwarmWeightRow[];
    const map = new Map<string, SwarmWeightRow>();
    for (const row of rows) {
        map.set(`${row.network}_${row.agent_id}`, row);
    }
    return map;
}

export function updateSwarmWeight(
    db: Database.Database,
    swarmId: string,
    network: string,
    agentId: string,
    weight: number,
    pnlDelta: number,
    eliminated: boolean
) {
    db.prepare(`
        UPDATE swarm_weights
        SET weight = @weight,
            iterations = iterations + 1,
            cumulative_pnl = cumulative_pnl + @pnl_delta,
            eliminated = @eliminated,
            updated_at = datetime('now')
        WHERE swarm_id = @swarm_id AND network = @network AND agent_id = @agent_id
    `).run({
        swarm_id: swarmId,
        network,
        agent_id: agentId,
        weight,
        pnl_delta: pnlDelta,
        eliminated: eliminated ? 1 : 0,
    });
}

export function saveCompetitionIteration(
    db: Database.Database,
    row: {
        iteration_id: string;
        swarm_id: string;
        purpose: string;
        window_ms: number;
        oracle_source: string;
        agents_scored: number;
        agents_total: number;
        ensemble_action: string | null;
        ensemble_confidence: number | null;
        ensemble_return_pct: number | null;
        ensemble_json: string;
    }
) {
    db.prepare(`
        INSERT INTO competition_iterations (
            iteration_id, swarm_id, purpose, window_ms, oracle_source,
            agents_scored, agents_total, ensemble_action, ensemble_confidence,
            ensemble_return_pct, ensemble_json
        ) VALUES (
            @iteration_id, @swarm_id, @purpose, @window_ms, @oracle_source,
            @agents_scored, @agents_total, @ensemble_action, @ensemble_confidence,
            @ensemble_return_pct, @ensemble_json
        )
    `).run(row);
}

export function saveIterationResult(
    db: Database.Database,
    row: {
        iteration_id: string;
        network: string;
        agent_id: string;
        agent_name: string;
        standardized_json: string;
        action: string;
        raw_return_pct: number;
        pnl_usd: number;
        weight_before: number;
        weight_after: number;
        scored: boolean;
    }
) {
    db.prepare(`
        INSERT INTO iteration_results (
            iteration_id, network, agent_id, agent_name, standardized_json,
            action, raw_return_pct, pnl_usd, weight_before, weight_after, scored
        ) VALUES (
            @iteration_id, @network, @agent_id, @agent_name, @standardized_json,
            @action, @raw_return_pct, @pnl_usd, @weight_before, @weight_after, @scored
        )
    `).run({ ...row, scored: row.scored ? 1 : 0 });
}
