import { ERC8004Agent } from "../indexer/agentFetcher";
import { auditAgent, AuditResult, ToolInfo } from "./auditor";
import {
    openDatabase,
    clearRunTasks,
    upsertAgentTask,
    upsertValidAgent,
    upsertFailedAgent,
    getTaskSummary,
    getRegistrySummary,
    TaskStatus,
} from "./database";
import Database from "better-sqlite3";

const AGENT_TIMEOUT_MS = 30_000;

// ─── Smart argument builder ────────────────────────────────────────────────────
/**
 * Builds the best possible arguments for a tool call using the tool's
 * JSON Schema (inputSchema). Without this, we always send {} which causes
 * -32602 validation errors for tools that require parameters (e.g. chainId).
 *
 * Strategy:
 *   1. If the schema has `required` properties, fill them with sensible defaults.
 *   2. Strings → use contextual defaults (chainId → "8453", address → placeholder)
 *   3. Numbers → 0, booleans → false, arrays → [], objects → {}
 *   4. Enums → pick the first valid value
 */
function buildToolArguments(toolName: string, schema: any, userPrompt: string): Record<string, any> {
    if (!schema || !schema.properties) return {};

    const required: string[] = schema.required ?? [];
    const properties: Record<string, any> = schema.properties;
    const args: Record<string, any> = {};

    // Common well-known field defaults
    const KNOWN_DEFAULTS: Record<string, any> = {
        chainId:   8453,                            // Base Mainnet chain ID (number)
        chain_id:  8453,
        chainid:   8453,
        network:   "base",
        networkId: 8453,
        address:   "0x0000000000000000000000000000000000000000",
        wallet:    "0x0000000000000000000000000000000000000000",
        account:   "0x0000000000000000000000000000000000000000",
        token:     "0x0000000000000000000000000000000000000000",
        symbol:    "ETH",
        asset:     "ETH",
        pair:      "ETH/USDC",
        prompt:    userPrompt,
        query:     userPrompt,
        message:   userPrompt,
        limit:     10,
        page:      1,
        offset:    0,
        amount:    "0",
    };

    // Only fill required fields (to minimize validation failures from optional fields)
    const fieldsToFill = required.length > 0 ? required : Object.keys(properties).slice(0, 3);

    for (const key of fieldsToFill) {
        const prop = properties[key];
        if (!prop) continue;

        // Check known defaults first
        const normalizedKey = key.toLowerCase();
        if (normalizedKey in KNOWN_DEFAULTS) {
            let val = KNOWN_DEFAULTS[normalizedKey];
            // Type coercion: if schema says string but we have a number
            if (prop.type === "string" && typeof val === "number") {
                val = String(val);
            } else if (prop.type === "integer" || prop.type === "number") {
                val = Number(val);
            }
            args[key] = val;
            continue;
        }

        // Enum → use first value
        if (prop.enum && prop.enum.length > 0) {
            args[key] = prop.enum[0];
            continue;
        }

        // anyOf / oneOf → use first branch
        if (prop.anyOf || prop.oneOf) {
            const variants = prop.anyOf ?? prop.oneOf;
            const firstVariant = variants[0];
            if (firstVariant.type === "integer" || firstVariant.type === "number") {
                args[key] = 8453; // Most common: chainId
            } else if (firstVariant.type === "string") {
                args[key] = "8453";
            } else {
                args[key] = 8453;
            }
            continue;
        }

        // Type-based fallback
        switch (prop.type) {
            case "string":  args[key] = ""; break;
            case "integer":
            case "number":  args[key] = 0; break;
            case "boolean": args[key] = false; break;
            case "array":   args[key] = []; break;
            case "object":  args[key] = {}; break;
            default:        args[key] = null; break;
        }
    }

    return args;
}

// ─── SwarmManager ─────────────────────────────────────────────────────────────

export class SwarmManager {
    private db: Database.Database;

    constructor() {
        this.db = openDatabase();
        clearRunTasks(this.db);
    }

    public initializeSwarmTask(agents: ERC8004Agent[], _userPrompt: string) {
        agents.forEach(agent => {
            const mcpService = agent.services?.find(s => s.name === "MCP");
            const endpoint = mcpService?.endpoint ?? "";

            upsertAgentTask(this.db, {
                network: agent.network,
                agent_id: agent.id,
                agent_name: agent.name ?? "Unknown",
                endpoint,
                discovery_keyword: agent.discovery_keyword,
                has_mcp: agent.has_mcp ? 1 : 0,
                is_free: agent.is_free ? 1 : 0,
                status: "PENDING",
            });
        });

        console.log(`\n[DB] Registered ${agents.length} agents as PENDING.`);
    }

    public async executeTask(userPrompt: string) {
        const pendingAgents = this.db.prepare(
            `SELECT * FROM agent_tasks WHERE status = 'PENDING'`
        ).all() as any[];

        console.log(`\n[Swarm] Broadcasting to ${pendingAgents.length} agents via MCP...`);
        console.log(`[Swarm] Prompt: "${userPrompt}"\n`);

        const domainQueues: Record<string, any[]> = {};
        for (const row of pendingAgents) {
            try {
                const url = new URL(row.endpoint);
                const domain = url.hostname;
                if (!domainQueues[domain]) domainQueues[domain] = [];
                domainQueues[domain].push(row);
            } catch {
                if (!domainQueues["unknown"]) domainQueues["unknown"] = [];
                domainQueues["unknown"].push(row);
            }
        }

        const domainPromises = Object.values(domainQueues).map(async (queue) => {
            for (const row of queue) {
                await this.callAgent(row, userPrompt);
                await new Promise(r => setTimeout(r, 1000));
            }
        });

        await Promise.all(domainPromises);

        console.log(`\n[Swarm] All MCP calls concluded.`);
    }

    private async callAgent(row: any, userPrompt: string) {
        const { network, agent_id, agent_name, endpoint, discovery_keyword, has_mcp, is_free } = row;

        if (!endpoint) {
            this.setStatus(network, agent_id, "FAILED", "No MCP endpoint registered for this agent.");
            upsertFailedAgent(this.db, network, agent_id, agent_name, endpoint ?? "", discovery_keyword, has_mcp, is_free, "UNKNOWN_ERROR", "No MCP endpoint registered");
            return;
        }

        this.setStatus(network, agent_id, "FETCHING_AGENT");
        console.log(`[→] Agent ${network}:${agent_id} (${agent_name}) | Auditing: ${endpoint}`);

        const audit: AuditResult = await auditAgent(agent_id, agent_name, endpoint, AGENT_TIMEOUT_MS);

        if (audit.health !== "HEALTHY") {
            const status: TaskStatus = audit.health === "TIMEOUT" ? "TIMEOUT" : "FAILED";
            this.setStatus(network, agent_id, status, audit.notes);
            upsertFailedAgent(this.db, network, agent_id, agent_name, audit.endpoint, discovery_keyword, has_mcp, is_free, audit.health, audit.notes);
            console.log(`[✗] Agent ${network}:${agent_id} → ${audit.health} | ${audit.notes}`);
            return;
        }

        console.log(`[✓] Agent ${network}:${agent_id} is VALID (${audit.responseTimeMs}ms) | Tools: [${audit.availableTools.join(", ") || "none"}] | via: ${audit.winningVariant}`);

        upsertValidAgent(
            this.db, network, agent_id, agent_name, audit.endpoint, discovery_keyword, has_mcp, is_free,
            audit.winningVariant ?? "", audit.availableTools, audit.responseTimeMs
        );

        if (audit.availableTools.length === 0) {
            upsertAgentTask(this.db, {
                network, agent_id, agent_name, endpoint: audit.endpoint, discovery_keyword, has_mcp, is_free,
                status: "PARSING_LLM", raw_response: "[Agent has no tools registered]",
            });
            console.log(`[~] Agent ${network}:${agent_id} has no tools — stored as-is.`);
            return;
        }

        try {
            // Try each tool until one returns a meaningful response
            const rawResponse = await this.executeBestTool(
                audit.endpoint, audit.winningVariant!, audit.toolSchemas, userPrompt, AGENT_TIMEOUT_MS
            );

            upsertAgentTask(this.db, {
                network, agent_id, agent_name, endpoint: audit.endpoint, discovery_keyword, has_mcp, is_free,
                status: "PARSING_LLM", raw_response: rawResponse,
            });
            console.log(`[✓] Agent ${network}:${agent_id} tool response saved to DB.`);
        } catch (err: any) {
            const msg = err.message || "Tool execution error";
            upsertAgentTask(this.db, {
                network, agent_id, agent_name, endpoint: audit.endpoint, discovery_keyword, has_mcp, is_free,
                status: "PARSING_LLM", raw_response: msg,
            });
            console.log(`[~] Agent ${network}:${agent_id} tool error (still saved): ${msg}`);
        }
    }

    /**
     * Tries each available tool in order, using schema-informed arguments.
     * Returns the first non-error response, or the last error message.
     */
    private async executeBestTool(
        endpoint: string,
        winningVariant: string,
        toolSchemas: ToolInfo[],
        userPrompt: string,
        timeoutMs: number
    ): Promise<string> {
        let lastError = "No tools attempted";

        // Prioritize tools that are likely to return market data or trading opportunities,
        // pushing static directory tools (like 'get-available-protocols') to the back.
        const sortedTools = [...toolSchemas].sort((a, b) => {
            const getScore = (name: string) => {
                const n = name.toLowerCase();
                if (n.includes("opportunit") || n.includes("apy") || n.includes("yield") || n.includes("price") || n.includes("market") || n.includes("tvl")) return 2;
                if (n.includes("protocol") || n.includes("wallet") || n.includes("user")) return 0;
                return 1;
            };
            return getScore(b.name) - getScore(a.name);
        });

        for (const tool of sortedTools) {
            try {
                const args = buildToolArguments(tool.name, tool.inputSchema, userPrompt);
                console.log(`  [Tool] Calling "${tool.name}" with args: ${JSON.stringify(args)}`);
                const result = await this.executeToolCall(endpoint, winningVariant, tool.name, args, timeoutMs);

                // If the result is an MCP validation error, try the next tool
                if (result.startsWith("MCP error -32602")) {
                    console.log(`  [Tool] "${tool.name}" rejected args, trying next tool...`);
                    lastError = result;
                    continue;
                }

                return result;
            } catch (err: any) {
                lastError = err.message || "Unknown tool error";
                console.log(`  [Tool] "${tool.name}" threw: ${lastError}`);
            }
        }

        // Return last error so it still gets stored in DB (for LLM to see)
        return lastError;
    }

    private async executeToolCall(
        endpoint: string,
        winningVariant: string,
        toolName: string,
        toolArgs: Record<string, any>,
        timeoutMs: number
    ): Promise<string> {
        const useOldProto = winningVariant.includes("2024-10-07");
        const useJsonOnly = winningVariant.includes("JSON-only");
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Accept": useJsonOnly ? "application/json" : "application/json, text/event-stream",
            "User-Agent": "curl/8.4.0",
        };

        // Re-initialize to get a fresh session
        const initRes = await fetch(endpoint, {
            method: "POST", headers,
            body: JSON.stringify({
                jsonrpc: "2.0", id: 1, method: "initialize",
                params: {
                    protocolVersion: useOldProto ? "2024-10-07" : "2024-11-05",
                    capabilities: {},
                    clientInfo: { name: "HSwarm-Auditor", version: "2.0" },
                },
            }),
        });

        const sessionId = initRes.headers.get("Mcp-Session-Id");
        if (sessionId) headers["Mcp-Session-Id"] = sessionId;
        try { await initRes.text(); } catch { /* drain */ }

        const notifRes = await fetch(endpoint, {
            method: "POST", headers,
            body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        });
        try { await notifRes.text(); } catch { /* drain */ }

        const execRes = await fetch(endpoint, {
            method: "POST", headers,
            body: JSON.stringify({
                jsonrpc: "2.0", id: 3, method: "tools/call",
                params: { name: toolName, arguments: toolArgs },
            }),
        });

        // Apply a body-read timeout to prevent SSE streams from hanging
        const text = await new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("BODY_READ_TIMEOUT")), 10_000);
            execRes.text()
                .then(t => { clearTimeout(timer); resolve(t); })
                .catch(e => { clearTimeout(timer); reject(e); });
        });

        let data: any;
        try {
            data = JSON.parse(text);
        } catch {
            for (const line of text.split("\n").filter(l => l.startsWith("data: "))) {
                try {
                    const p = JSON.parse(line.replace("data: ", "").trim());
                    if (p.result !== undefined || p.error !== undefined) { data = p; break; }
                } catch {}
            }
        }

        if (!data) return text;
        if (data.error) return `MCP error ${data.error.code}: ${data.error.message}`;
        const blocks: any[] = data.result?.content ?? [];
        return blocks.map((b: any) => b.text ?? JSON.stringify(b)).join("\n") || JSON.stringify(data.result);
    }

    private setStatus(network: string, agentId: string, status: TaskStatus, error?: string) {
        this.db.prepare(`
            UPDATE agent_tasks
            SET status = ?, error = COALESCE(?, error), updated_at = datetime('now')
            WHERE network = ? AND agent_id = ?
        `).run(status, error ?? null, network, agentId);
        console.log(`[Agent ${network}:${agentId}] → ${status}${error ? ` (${error})` : ""}`);
    }

    public printDatabase() {
        const runSummary = getTaskSummary(this.db);
        console.log("\n=== This Run — agent_tasks ===");
        runSummary.forEach(({ status, count }) => { console.log(`  ${status}: ${count}`); });

        const registry = getRegistrySummary(this.db);
        console.log("\n=== Persistent Registry ===");
        console.log(`  valid_agents  : ${registry.valid}`);
        console.log(`  failed_agents : ${registry.failed}`);
        console.log(`  total audited : ${registry.total}`);
        console.log(`  failed by category:`);
        registry.byCategory.forEach(({ failure_category, count }) => {
            console.log(`    ${failure_category}: ${count}`);
        });
    }

    public getDb(): Database.Database { return this.db; }
}
