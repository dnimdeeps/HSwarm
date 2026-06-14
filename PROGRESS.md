# HSwarm — Build Progress

> A living document that tracks how HSwarm is being built, step by step.
> Updated as each step is completed.

---

## What is HSwarm?

A protocol that solves the **reputation monopoly** in the ERC-8004 agent economy.

Instead of users always hiring the most famous agent (creating a monopoly), HSwarm randomly groups low-reputation agents by *function* into a **Black Box**, forces them to compete, measures who performs best, and adjusts their weights over time. The best agents rise naturally. The worst eliminate themselves.

---

## STEP 1 — Agent Discovery ✅ COMPLETED

### What it is
Capture real AI agents registered on-chain via the **ERC-8004 standard**. Provide an interactive prompt to select the network (Ethereum Mainnet, Base, Arbitrum/Testnet, or All) and select agents randomly by category, ignoring reputation entirely.

### How it's solved
- Queries the **ERC-8004 Subgraphs** (The Graph) dynamically based on the user's CLI network selection to fetch ALL agent IDs on-chain.
- Loads all already-audited IDs from `valid_agents` + `failed_agents` and **skips them entirely** before any IPFS resolution.
- Shuffles the remaining **unaudited** agents randomly — no reputation bias.
- Lazy-loads IPFS metadata in batches of 50 until `limit` matching agents are found, using a strict **5-second timeout** to prevent hanging on dead IPFS gateways.
- Stops IPFS resolution as soon as `limit` is reached (bandwidth-efficient).

### Key files
- [`src/indexer/agentFetcher.ts`](./src/indexer/agentFetcher.ts) — on-chain discovery + IPFS resolution + exclusion logic
- [`src/index.ts`](./src/index.ts) — loads known IDs, orchestrates swarm size and filter config

---

## STEP 2 — Agent Audit & Persistent Registry ✅ COMPLETED

### What it is
Connect to each agent's real MCP server, probe it with 16 protocol variants, and write the result permanently into either `valid_agents` or `failed_agents`. These tables accumulate across every run — they are never wiped.

### How it's solved

#### Phase A: Self-Healing Auditor
Before marking any agent as failed, the system tries **16 combinations** per agent:
- 4 endpoint path suffixes: `/`, `/mcp`, `/v1`, `/sse`
- 4 protocol variants: two MCP versions (`2024-11-05` / `2024-10-07`) × two Accept headers (`JSON+SSE` / `JSON only`)

#### Phase B: Tool Execution
If the agent passes the audit (status = `VALID`):
1. Re-initializes with the winning variant (captures `Mcp-Session-Id` for stateful servers)
2. Calls the first available tool with the user's prompt
3. Parses response — handles both plain JSON and Server-Sent Events (SSE) streams

#### Database Model
```
valid_agents    ← PERSISTENT. Accumulates forever. Never cleared.
failed_agents   ← PERSISTENT. Accumulates forever. Never cleared.
agent_tasks     ← EPHEMERAL.  Cleared at the start of every run.
```

#### State Machine (per run, in agent_tasks)
```
PENDING → FETCHING_AGENT → PARSING_LLM   ✅ (agent responded → also written to valid_agents)
                         → FAILED         ❌ (all 16 variants failed → also written to failed_agents)
                         → TIMEOUT        ⏱ (exceeded time limit → also written to failed_agents)
```

#### Domain-Based Rate Limiting
Agents from the same domain (e.g. multiple Zyfai wallets) are queued **sequentially with a 1-second delay**. Different domains run in **full parallel**.

#### Failure Categories
| Category | Meaning |
|---|---|
| `DEAD_LINK` | Server is offline / 404 (e.g. deleted Railway deployments) |
| `OAUTH_GATED` | Requires auth token — lied about being free (e.g. Dexter.cash) |
| `BAD_PROTOCOL` | Returns HTML or doesn't support POST (e.g. Olas static files) |
| `STRICT_VALIDATION` | Rejects generic args at HTTP layer before MCP handshake |
| `TIMEOUT` | No response within time limit |
| `UNKNOWN_ERROR` | Rate limited (429) or DNS failure |

### Key files
- [`src/orchestrator/auditor.ts`](./src/orchestrator/auditor.ts) — self-healing 16-variant probe
- [`src/orchestrator/swarmManager.ts`](./src/orchestrator/swarmManager.ts) — domain queue + tool execution + persistent writes
- [`src/orchestrator/database.ts`](./src/orchestrator/database.ts) — SQLite schema (`valid_agents`, `failed_agents`, `agent_tasks`)

### Registry so far
From Run 1 (50-agent sample): **37 valid / 13 failed** — all failures confirmed after 16 attempts each.

> Run 1 data was migrated from the old schema via [`migrate.js`](./migrate.js).

---

## STEP 3 — LLM Standardization ✅ COMPLETED

### What it is
Take every raw agent response stored in `PARSING_LLM` and send it to **Hugging Face Inference Providers** (chat completions API) to convert it into a **unified JSON format**.

### How it's solved
- Uses `HF_TOKEN` and `POST https://router.huggingface.co/v1/chat/completions`
- Default model: `meta-llama/Llama-3.1-8B-Instruct` (override with `HF_MODEL`)
- Structured output via `response_format: json_schema` → `{ action, asset, confidence, reasoning }`
- Sequential calls with 4s delay (rate-limit safe)
- Retries on 429/503; marks all rows `FAILED` if `HF_TOKEN` is missing

### Key files
- [`src/orchestrator/llmStandardizer.ts`](./src/orchestrator/llmStandardizer.ts)

---

## STEP 4 — Competition & Weight Scoring 📋 PLANNED

### What it is
Process the standardized database and subject all agents to **real-world testing**. Have them compete against each other and progressively eliminate the weakest.

### The vision
- All agents start with **equal weight** (e.g. 100 agents = 0.01 each, total = 1.0)
- Agents are evaluated over a time window (e.g. 1 hour for trading strategies)
- Results are compared against ground truth (e.g. actual ETH/USDC price movement)
- Agents that predicted correctly **gain weight**, those that were wrong **lose weight**
- Weight growth is **logarithmic** — a slightly worse agent isn't harshly punished, preserving collaboration
- Agents with weight → 0 are eliminated naturally
- Top performers rise organically and can earn on-chain reputation via ERC-8004

### Not started yet
