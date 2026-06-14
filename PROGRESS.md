# HSwarm — Build Progress

> Living document tracking what HSwarm is and how it's built.
> Updated as each step is completed.

---

## What is HSwarm?

A pipeline that discovers real AI agents from ERC-8004 on-chain registries, audits them, reaches consensus via LangGraph, and deploys the result as a functioning on-chain product (currently ERC-4626 vaults on Arbitrum).

Instead of agents competing for reputation individually, HSwarm groups them by function into a **swarm**, runs them through a LangGraph consensus engine to produce a unified strategy, then executes that strategy on-chain.

---

## STEP 1 — Agent Discovery ✅ COMPLETED

### What it is
Capture real AI agents registered on-chain via ERC-8004. Agents are selected by function and availability — not by reputation.

### How it's solved
- Queries ERC-8004 subgraphs (The Graph) across 4 chains: Ethereum Mainnet, Base, Arbitrum, BNB Chain
- Skips already-audited agents (`valid_agents` + `failed_agents`) before any IPFS resolution
- Shuffles remaining unaudited agents randomly — zero reputation bias
- Lazy-loads IPFS metadata in batches of 50 with 5-second timeout per agent
- Stops as soon as the target swarm size is reached

### Key files
- [`src/indexer/agentFetcher.ts`](./src/indexer/agentFetcher.ts) — on-chain discovery + IPFS resolution + exclusion logic
- [`src/index.ts`](./src/index.ts) — loads known IDs, orchestrates swarm size and filter config

---

## STEP 2 — Agent Audit & Persistent Registry ✅ COMPLETED

### What it is
Connect to each agent's real MCP server, probe it with 16 protocol variants, and write the result permanently into `valid_agents` or `failed_agents`.

### How it's solved
**Self-Healing Auditor:** Before marking any agent as failed, tries 16 combinations:
- 4 endpoint paths: `/`, `/mcp`, `/v1`, `/sse`
- 4 protocol variants: 2 MCP versions × 2 Accept headers

**Persistent database** (SQLite, never wiped between runs):
- `valid_agents` — agents that responded and have working tools
- `failed_agents` — agents where all 16 variants failed (with failure category)
- `agent_tasks` — ephemeral scratchpad cleared each run

**Failure categories:**
| Category | Meaning |
|---|---|
| `DEAD_LINK` | Server is offline / 404 |
| `OAUTH_GATED` | Requires auth token — lied about being free |
| `BAD_PROTOCOL` | Returns HTML, doesn't support POST |
| `STRICT_VALIDATION` | Rejects generic args at HTTP layer |
| `TIMEOUT` | No response within time limit |
| `UNKNOWN_ERROR` | Rate limited or DNS failure |

### Key files
- [`src/orchestrator/auditor.ts`](./src/orchestrator/auditor.ts) — 16-variant probe
- [`src/orchestrator/swarmManager.ts`](./src/orchestrator/swarmManager.ts) — domain queue + tool execution + persistent writes
- [`src/orchestrator/database.ts`](./src/orchestrator/database.ts) — SQLite schema

---

## STEP 3 — LLM Standardization ✅ COMPLETED

### What it is
Send every raw agent response to a Hugging Face LLM to normalize it into a unified JSON format.

### How it's solved
- Uses Hugging Face Inference Providers (`HF_TOKEN` + chat completions API)
- Default model: `meta-llama/Llama-3.1-8B-Instruct` (overridable via `HF_MODEL`)
- Structured output via `response_format: json_schema` → `{ action, asset, confidence, reasoning }`
- Sequential calls with rate-limit delay; retries on 429/503

### Key files
- [`src/orchestrator/llmStandardizer.ts`](./src/orchestrator/llmStandardizer.ts)

---

## STEP 4 — LangGraph Consensus ✅ COMPLETED

### What it is
Instead of the original competition/weighting concept, HSwarm uses **LangGraph** to run the swarm through a consensus pipeline. Standardized agent data feeds into a multi-agent graph that analyzes, debates, and produces a final decision.

### The actual implementation
- **Ingestion** — standardized agent data enters the graph
- **Analysis** — LLM analysts evaluate the data
- **Decision** — consensus is reached on the optimal strategy
- **Deployment output** — a blueprint JSON with allocations, protocols, pool names, APY targets, and rebalance config

This replaced the earlier "competitive ensemble" architecture where agents voted LONG/SHORT.

### Key files
- [`src/competition/langgraphRunner.ts`](./src/competition/langgraphRunner.ts) — LangGraph pipeline
- [`src/run_auto.ts`](./src/run_auto.ts) — pipeline orchestrator

---

## STEP 5 — On-Chain Deployment ✅ COMPLETED

### What it is
Deploy the swarm's consensus decision as a real ERC-4626 vault on Arbitrum with protocol adapters (Aave, Morpho, Compound) and Chainlink Automation for rebalancing.

### How it works
1. **Protocol normalization** — pool names (Gauntlet, Steakhouse, Moonwell) are mapped to their protocols (Morpho) and allocations are consolidated
2. **Allocation validation** — allocations are normalized to sum 10000 bps; `maxSingleProtocolBps` is computed
3. **VaultFactory deployment** — a factory contract is deployed (or reused)
4. **HSwarmVault creation** — ERC-4626 vault with strategy config (rebalance interval, min APY, max single protocol cap)
5. **Adapter deployment** — one adapter per protocol (AaveAdapter → Aave V3, MorphoAdapter → Morpho Blue, CompoundAdapter → Compound V3)
6. **Allocations set** — on-chain, targets must sum to exactly 10000 bps
7. **Chainlink Automation registration** — upkeep registered so the vault rebalances automatically on a timer

**Deployed on Arbitrum One:** Vault at `0x201ea2ade98112973C14B822e7Ff034d1f435b00` with Chainlink upkeep ID `69807263058704082676571068256513945276145989435541215317533139799806854460064`.

### Key files
- [`src/executor/deployVault.ts`](./src/executor/deployVault.ts) — deployment pipeline
- [`src/executor/chainlinkActionProvider.ts`](./src/executor/chainlinkActionProvider.ts) — Chainlink Automation registration
- [`contracts/src/HSwarmVault.sol`](./contracts/src/HSwarmVault.sol) — vault contract
- [`contracts/src/adapters/`](./contracts/src/adapters/) — protocol adapters
- [`contracts/src/VaultFactory.sol`](./contracts/src/VaultFactory.sol) — factory contract

---

## STEP 6 — Frontend Dashboard ✅ COMPLETED

### What it is
A React web app that connects to deployed vaults and allows users to deposit/withdraw USDC, view on-chain data, and monitor the swarm's strategy.

### How it works
- **Wallet connection** via RainbowKit (MetaMask, Phantom, WalletConnect)
- **Vault dashboard** at `/vault/:address` — reads all data directly from the smart contract (no backend dependency)
- **Deposit/Withdraw** with automatic USDC approval handling
- **Live event log** — deposits, withdrawals, rebalances parsed from on-chain events
- **Allocations** — shows current protocol allocation targets from the contract
- **Chainlink Automation status** — rebalance countdown, link to Chainlink dashboard
- **Multi-chain** — supports both Arbitrum Sepolia and Arbitrum One

### Key files
- [`frontend/`](./frontend/) — React + Vite + TypeScript app
- [`frontend/src/pages/VaultDashboard.tsx`](./frontend/src/pages/VaultDashboard.tsx) — standalone vault page
- [`frontend/src/main.tsx`](./frontend/src/main.tsx) — wagmi config (Arbitrum Sepolia + Arbitrum One)
- [`server.js`](./server.js) — API backend for agent registry and pipeline control

---

## Pipeline Overview

```
Agent Discovery → Audit → LLM Standardization → LangGraph Consensus → On-Chain Deployment → Frontend
   (Step 1)      (Step 2)      (Step 3)               (Step 4)           (Step 5)          (Step 6)
```

Each pipeline run is started with:
```bash
npx ts-node src/run_auto.ts "<network>" <purpose> <num_agents>
```

Networks: `Arbitrum Sepolia`, `Arbitrum One`, `Ethereum Mainnet`, `Base Mainnet`, `BNB Chain`
Purpose: `VAULT` (default), `VISUAL`
