# HSwarm

**Agent Swarm Protocol — from ERC-8004 discovery to on-chain deployment.**

HSwarm discovers real AI agents registered on-chain via ERC-8004, audits them for compatibility, runs them through a LangGraph consensus pipeline, and deploys the resulting strategy as a functioning smart contract on Arbitrum.

See [`HSwarm.md`](./HSwarm.md) for full documentation.

---

## Quick Start

```bash
npm install
```

Create a `.env` file (see `.env.example` or below):

```env
PRIVATE_KEY=0x...
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-arbitrum.gateway...
ARBITRUM_MAINNET_RPC_URL=https://arbitrum-mainnet.gateway...
SUBGRAPH_URL_ARB=https://api.studio.thegraph.com/query/.../version/latest
HF_TOKEN=hf_...
GEMINI_API_KEY=AIza...
```

### Run the full pipeline

```bash
npx ts-node src/run_auto.ts "Arbitrum Sepolia" VAULT 10
```

This runs: Agent Discovery → Audit → LLM Standardization → LangGraph Consensus → On-Chain Deployment

### Start the frontend

```bash
# Terminal 1 — API backend
node server.js

# Terminal 2 — Frontend dev server
cd frontend && npm run dev
```

Then open `http://localhost:5173/vault/<vault-address>`

---

## Pipeline

| Step | What it does |
|------|-------------|
| 1 — Discovery | Queries ERC-8004 subgraphs across 4 chains, selects agents by function (not reputation) |
| 2 — Audit | Probes each agent's MCP server with 16 protocol variants, stores results permanently |
| 3 — Standardization | Normalizes raw agent responses into unified JSON via Hugging Face LLM |
| 4 — Consensus | LangGraph pipeline analyzes data and produces a unified strategy blueprint |
| 5 — Deployment | Deploys ERC-4626 vault on Arbitrum with protocol adapters + Chainlink Automation |
| 6 — Frontend | React dashboard for deposit/withdraw and vault monitoring |

---

## Project Structure

```
src/                — Pipeline (discovery, audit, consensus, deployment)
contracts/          — Solidity vault + adapters (Foundry)
frontend/           — React web app (Vite + wagmi + RainbowKit)
server.js           — API backend for agent registry
deployments.json    — Deployed vault records (safe to commit)
swarm_responses.db  — Agent database (gitignored)
```

---

## Current Deployments

| Network | Vault | Strategy |
|---------|-------|----------|
| Arbitrum One | `0x201ea2ade98112973C14B822e7Ff034d1f435b00` | Safe USDC Yield Enhancer |

Chainlink Automation: https://automation.chain.link/arbitrum/69807263058704082676571068256513945276145989435541215317533139799806854460064
