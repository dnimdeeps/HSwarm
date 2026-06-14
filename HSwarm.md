# HSwarm

**Agent Swarm Protocol — from ERC-8004 discovery to on-chain deployment.**

HSwarm discovers real AI agents registered on-chain via ERC-8004, audits them for compatibility, runs them through a LangGraph consensus pipeline, and deploys the resulting strategy as a functioning smart contract on Arbitrum.

---

## What It Does

The pipeline takes agents that no one has heard of and produces a real, working on-chain product:

1. **Discover** agents from ERC-8004 subgraphs across 4 chains
2. **Audit** each agent against 16 MCP protocol variants
3. **Standardize** raw agent responses into unified JSON via LLM
4. **Consensus** via LangGraph — the swarm produces a unified strategy
5. **Deploy** the strategy as an ERC-4626 vault with protocol adapters and Chainlink Automation
6. **Dashboard** — a web UI to deposit/withdraw and monitor the vault

---

## Pipeline

```
Agent Discovery → Audit → LLM Standardization → LangGraph Consensus → On-Chain Deployment → Frontend
   (Step 1)      (Step 2)      (Step 3)               (Step 4)           (Step 5)          (Step 6)
```

### Step 1 — Agent Discovery
Queries ERC-8004 subgraphs on Ethereum Mainnet, Base, Arbitrum, and BNB Chain. Skips already-known agents, shuffles randomly (no reputation bias), lazy-loads IPFS metadata with timeouts. Zero trust on reputation — agents are selected purely by function and availability.

### Step 2 — Agent Audit
Connects to each agent's MCP server and probes 16 protocol variants (4 endpoint paths × 4 combinations of MCP version + Accept header). Results are written permanently to a SQLite database — `valid_agents` or `failed_agents` with a failure category. Never re-tests known agents.

### Step 3 — LLM Standardization
Sends each agent's raw response to Hugging Face Inference (default: `Llama-3.1-8B-Instruct`) to normalize it into `{ action, asset, confidence, reasoning }`. Handles rate limits, retries, and missing configuration gracefully.

### Step 4 — LangGraph Consensus
Instead of agents competing against each other, the swarm feeds into a **LangGraph** where LLM analysts evaluate the data, debate, and produce a unified consensus: protocol recommendations, pool selections, allocation percentages, and rebalance configuration. Output is a blueprint JSON.

### Step 5 — On-Chain Deployment
Takes the swarm's blueprint and deploys:
- **VaultFactory** — reusable factory contract
- **HSwarmVault** — ERC-4626 vault with configurable strategy (rebalance interval, min APY, max single-protocol allocation)
- **Protocol Adapters** — AaveAdapter, MorphoAdapter, CompoundAdapter that route deposits to their respective protocols
- **Allocations** — set on-chain, must sum to exactly 10000 bps
- **Chainlink Automation** — registers an upkeep so the vault rebalances automatically

Pool names (e.g. "Gauntlet", "Steakhouse", "Moonwell") are normalized to their protocols (Morpho) and allocations are consolidated — one adapter per protocol.

### Step 6 — Frontend Dashboard
React app with:
- Wallet connection via RainbowKit (MetaMask, Phantom, WalletConnect)
- Vault dashboard at `/vault/:address` — reads directly from the contract
- Deposit/Withdraw USDC with automatic approval
- Live event log (deposits, withdrawals, rebalances)
- Chainlink Automation status with countdown timer
- Multi-chain support (Arbitrum Sepolia + Arbitrum One)

---

## Current Deployments

| Network | Vault | Strategy | Chainlink Upkeep |
|---|---|---|---|
| Arbitrum One | `0x201ea2...1b00` | Safe USDC Yield Enhancer | `698072630587...664` |

Live dashboard: [Chainlink Automation](https://automation.chain.link/arbitrum/69807263058704082676571068256513945276145989435541215317533139799806854460064)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Contracts | Solidity 0.8.24, Foundry, OpenZeppelin |
| Chain | Arbitrum One, Arbitrum Sepolia |
| Automation | Chainlink Automation 2.1 |
| Protocols | Aave V3, Morpho Blue, Compound V3 |
| Consensus | LangGraph, Gemini/Qwen LLMs |
| Backend | TypeScript, Node.js, SQLite |
| Frontend | React, Vite, wagmi, RainbowKit, viem |
| Agent Registry | ERC-8004 subgraphs (The Graph) |

---

## Running the Pipeline

```bash
# Full pipeline (discovery → audit → standardize → consensus → deploy)
npx ts-node src/run_auto.ts "Arbitrum One" VAULT 10

# Start the API backend
node server.js

# Start the frontend dev server
cd frontend && npm run dev
```

**Configuration** (via `.env`, gitignored):
- `PRIVATE_KEY` — deployer wallet
- `HF_TOKEN` — Hugging Face API key (for LLM standardization)
- `GEMINI_API_KEY` — Gemini API key (for LangGraph)
- `ARBITRUM_MAINNET_RPC_URL` / `ARBITRUM_SEPOLIA_RPC_URL`
- `SUBGRAPH_URL_ETH`, `SUBGRAPH_URL_BASE`, `SUBGRAPH_URL_ARB`, `SUBGRAPH_URL_BNB`
- `KEEPER_ENABLED` — auto-start the rebalancer loop

Deployment info (vault address, adapters, upkeep ID) is written to `deployments.json` after each successful run — safe to commit (no secrets).

---

## Project Structure

```
src/
  indexer/          — ERC-8004 agent discovery + IPFS resolution
  orchestrator/     — agent audit, database, swarm management
  competition/      — LangGraph consensus runner
  executor/         — vault deployment, Chainlink registration, wallet
  keeper/           — automated rebalancer loop
  run_auto.ts       — pipeline orchestrator

contracts/           — Solidity smart contracts (Foundry)
  src/
    HSwarmVault.sol     — ERC-4626 vault
    VaultFactory.sol    — factory
    adapters/           — AaveAdapter, MorphoAdapter, CompoundAdapter

frontend/            — React web app (Vite + TypeScript)
  src/pages/
    VaultDashboard.tsx  — standalone vault page
    ProductDetail.tsx   — DB-backed product page
    AgenticProducts.tsx — product gallery
    LandingPage.tsx     — landing
    CreateOrJoin.tsx    — swarm creation hub

server.js            — API backend (agent registry, pipeline control)
swarm_responses.db   — SQLite database (gitignored)
deployments.json     — deployment records (safe to commit)
```

---

## Database

The SQLite database (`swarm_responses.db`) accumulates agent data across runs:

- `valid_agents` — agents that passed MCP audit (never cleared)
- `failed_agents` — agents that failed (with failure category, never cleared)
- `agent_tasks` — current run scratchpad (cleared each run)
- `agentic_products` — deployed products (vaults, visual dashboards)
- `swarms`, `swarm_weights`, `iteration_results`, `competition_iterations` — legacy tables from the old competition architecture (no longer actively used)
