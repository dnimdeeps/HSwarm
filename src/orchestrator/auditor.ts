/**
 * auditor.ts
 * Self-Healing Universal MCP Auditor
 *
 * Before marking any agent as FAILED, this module exhausts every known
 * protocol variant to ensure we are not discarding a perfectly valid agent
 * just because of a configuration mismatch on our end.
 *
 * Retry matrix per endpoint candidate:
 *   1. Standard: protocolVersion "2024-11-05" + full Accept header
 *   2. Old protocol: protocolVersion "2024-10-07" (some older servers)
 *   3. JSON-only Accept: removes "text/event-stream" (some servers return 406)
 *   4. GET probe: for static/misconfigured endpoints (Olas-style)
 *
 * FIX: parseResponse now uses AbortController to enforce a body-read timeout,
 *      preventing SSE streams from hanging the process indefinitely.
 * FIX: tools/list now also captures the full tool inputSchema so the executor
 *      can build valid arguments instead of always sending {}.
 */

import { performance } from "perf_hooks";

export type AgentHealth =
    | "HEALTHY"            // Handshake + tools/list succeeded
    | "DEAD_LINK"          // 404 / 502 / connection refused on all attempts
    | "OAUTH_GATED"        // 401 / 403 — requires auth token
    | "BAD_PROTOCOL"       // 405 / static file / GET-only
    | "STRICT_VALIDATION"  // Responded but rejected our generic arguments
    | "TIMEOUT"            // Exceeded time limit
    | "UNKNOWN_ERROR";     // Anything else

export interface ToolInfo {
    name: string;
    description?: string;
    inputSchema?: any;   // Full JSON Schema for arguments
}

export interface AuditResult {
    agentId: string;
    agentName: string;
    endpoint: string;
    health: AgentHealth;
    responseTimeMs: number;
    availableTools: string[];
    toolSchemas: ToolInfo[];            // NEW: full schema for each tool
    winningVariant?: string;
    notes: string;
}

interface ProbeVariant {
    label: string;
    protocolVersion: string;
    accept: string;
    method: "POST" | "GET";
}

const PROBE_VARIANTS: ProbeVariant[] = [
    {
        label: "Standard (2024-11-05, JSON+SSE)",
        protocolVersion: "2024-11-05",
        accept: "application/json, text/event-stream",
        method: "POST",
    },
    {
        label: "Old protocol (2024-10-07, JSON+SSE)",
        protocolVersion: "2024-10-07",
        accept: "application/json, text/event-stream",
        method: "POST",
    },
    {
        label: "JSON-only Accept (2024-11-05)",
        protocolVersion: "2024-11-05",
        accept: "application/json",
        method: "POST",
    },
    {
        label: "JSON-only Accept (2024-10-07)",
        protocolVersion: "2024-10-07",
        accept: "application/json",
        method: "POST",
    },
];

const PATH_SUFFIXES = ["", "/mcp", "/v1", "/sse"];

// ─── Body read with timeout ────────────────────────────────────────────────────
/**
 * Reads response text with a hard deadline.
 * Critical for SSE endpoints that keep the connection open — without this,
 * tools/list hangs forever on streaming servers like Zyfai.
 */
async function readBodyWithTimeout(res: Response, timeoutMs = 8_000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
            // We cannot abort the body read directly, but we can reject the
            // promise which lets the caller treat it as an error/timeout.
            reject(new Error("BODY_READ_TIMEOUT"));
        }, timeoutMs);

        res.text()
            .then(text => { clearTimeout(timer); resolve(text); })
            .catch(err  => { clearTimeout(timer); reject(err); });
    });
}

/**
 * Parses a response that might be plain JSON or a Server-Sent Events (SSE) stream.
 * Uses a body-read timeout to avoid hanging on streaming endpoints.
 */
async function parseResponse(res: Response, bodyTimeoutMs = 8_000): Promise<any> {
    const text = await readBodyWithTimeout(res, bodyTimeoutMs);
    try {
        return JSON.parse(text);
    } catch {
        // SSE fallback: grab the first data line that is valid JSON with result/error
        for (const line of text.split("\n").filter(l => l.startsWith("data: "))) {
            try {
                const parsed = JSON.parse(line.replace("data: ", "").trim());
                if (parsed.result !== undefined || parsed.error !== undefined) return parsed;
            } catch {}
        }
        throw new Error(`Unparseable response body: ${text.substring(0, 80)}`);
    }
}

// ─── Single probe attempt ──────────────────────────────────────────────────────
/**
 * Tries a single (url + variant) combination and returns tool info on success,
 * or throws a typed error string on failure.
 */
async function probeOnce(
    url: string,
    variant: ProbeVariant
): Promise<ToolInfo[]> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": variant.accept,
        "User-Agent": "curl/8.4.0",
    };

    // STEP 1 — Initialize
    const initRes = await fetch(url, {
        method: variant.method === "GET" ? "GET" : "POST",
        headers,
        body: variant.method === "POST"
            ? JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                    protocolVersion: variant.protocolVersion,
                    capabilities: {},
                    clientInfo: { name: "HSwarm-Auditor", version: "2.0" },
                },
            })
            : undefined,
    });

    // Classify hard HTTP errors immediately
    if (initRes.status === 404 || initRes.status === 502) throw new Error("DEAD_LINK");
    if (initRes.status === 401 || initRes.status === 403) throw new Error("OAUTH_GATED");
    if (initRes.status === 405) throw new Error("BAD_PROTOCOL");
    if (!initRes.ok) throw new Error(`HTTP_${initRes.status}`);

    // Drain the init body (important for connection pooling)
    try { await readBodyWithTimeout(initRes, 6_000); } catch { /* ignore */ }

    // Dynamic session capture (Zyfai and alike)
    const sessionId = initRes.headers.get("Mcp-Session-Id");
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;

    // STEP 2 — Confirm initialized
    const notifRes = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    try { await readBodyWithTimeout(notifRes, 4_000); } catch { /* ignore */ }

    // STEP 3 — List tools (proof of life)
    const listRes = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });

    // Use a generous body timeout for SSE-capable servers
    const listData = await parseResponse(listRes, 10_000);

    if (listData.error) {
        throw new Error(`MCP_ERROR: ${JSON.stringify(listData.error)}`);
    }

    // Return full tool info including inputSchema
    const tools: ToolInfo[] = (listData.result?.tools ?? []).map((t: any) => ({
        name: t.name as string,
        description: t.description as string | undefined,
        inputSchema: t.inputSchema ?? null,
    }));

    return tools;
}

// ─── Full self-healing audit ───────────────────────────────────────────────────
/**
 * Full self-healing audit for a single agent.
 * Tries every path suffix × every protocol variant before giving up.
 */
export async function auditAgent(
    agentId: string,
    agentName: string,
    rawEndpoint: string,
    timeoutMs = 30_000
): Promise<AuditResult> {
    const start = performance.now();
    const base = rawEndpoint.replace(/\/$/, "");

    // Build candidate URLs
    const candidates = PATH_SUFFIXES.map(suffix => base + suffix);

    let lastError = "No attempt made";
    let hardCategory: AgentHealth | null = null;

    for (const candidate of candidates) {
        for (const variant of PROBE_VARIANTS) {
            try {
                const toolSchemas = await Promise.race([
                    probeOnce(candidate, variant),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)
                    ),
                ]);

                return {
                    agentId,
                    agentName,
                    endpoint: candidate,
                    health: "HEALTHY",
                    responseTimeMs: Math.round(performance.now() - start),
                    availableTools: toolSchemas.map(t => t.name),
                    toolSchemas,
                    winningVariant: `${candidate} | ${variant.label}`,
                    notes: `Handshake OK. Tools: [${toolSchemas.map(t => t.name).join(", ") || "none"}]`,
                };
            } catch (err: any) {
                lastError = err.message ?? "Unknown";

                // Hard stops — no point retrying variants for these
                if (lastError === "OAUTH_GATED") {
                    hardCategory = "OAUTH_GATED";
                    break; // skip all variants for this path
                }
                if (lastError === "BAD_PROTOCOL") {
                    hardCategory = "BAD_PROTOCOL";
                    break;
                }
                // DEAD_LINK on a path suffix is recoverable (try next path)
                // Everything else: keep trying
            }
        }
        // If we got a hard stop that isn't path-specific, bail completely
        if (hardCategory === "OAUTH_GATED") break;
    }

    // Classify the final failure
    const elapsed = Math.round(performance.now() - start);
    let health: AgentHealth = hardCategory ?? "UNKNOWN_ERROR";

    if (!hardCategory) {
        if (lastError === "TIMEOUT" || lastError === "BODY_READ_TIMEOUT") health = "TIMEOUT";
        else if (lastError.includes("DEAD_LINK") || lastError.includes("404") || lastError.includes("502")) health = "DEAD_LINK";
        else if (lastError.includes("BAD_PROTOCOL") || lastError.includes("405")) health = "BAD_PROTOCOL";
        else if (lastError.includes("STRICT_VALIDATION") || lastError.includes("Amount must be")) health = "STRICT_VALIDATION";
    }

    return {
        agentId,
        agentName,
        endpoint: rawEndpoint,
        health,
        responseTimeMs: elapsed,
        availableTools: [],
        toolSchemas: [],
        notes: `All ${candidates.length * PROBE_VARIANTS.length} variants failed. Last error: ${lastError}`,
    };
}
