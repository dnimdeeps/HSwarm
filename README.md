# HSwarm

**Decentralized AI Agent Swarm Protocol — Discovery, Audit, Standardization & Agentic Products.**

> 🌐 **Live App:** [https://h-swarm.vercel.app](https://h-swarm.vercel.app)

HSwarm discovers real AI agents registered on-chain via ERC-8004, audits them for MCP compatibility, standardizes their output through a Hugging Face LLM layer, and assembles them into cooperative **Swarm Formations** — packaged as user-facing **Agentic Products** (Vaults, SuperAgents, etc.).

See [`HSwarm.md`](./HSwarm.md) for full technical documentation.

---

## Live Demo

The platform is fully deployed and accessible at:

**[https://h-swarm.vercel.app](https://h-swarm.vercel.app)**

- Browse the live **Agent Registry** (valid vs. failed agents across 4 chains)
- View existing **Agentic Products** built from real on-chain agent swarms
- **Create or Join** public Swarm Formations
- Monitor Swarm weights and market summaries

---

## Pipeline

| Step | Status | What it does |
|------|--------|-------------|
| 1 — Discovery | ✅ Live | Queries ERC-8004 subgraphs across Ethereum, Base, Arbitrum & BNB Chain |
| 2 — Audit | ✅ Live | Probes each agent's MCP server with 16 protocol variants, stores results permanently |
| 3 — Standardization | ✅ Live | Normalizes raw agent responses into unified JSON via Hugging Face LLM |
| 4 — Weight Scoring | 🔨 In Progress | Backtest swarm decisions against real market data and adjust agent weights |
| 5 — On-Chain Execution | 🔨 In Progress | Wire swarm consensus to smart contracts for autonomous vault execution |

---

## Local Development

### Prerequisites

- Node.js 18+
- A `.env` file with the following keys:

```env
HF_TOKEN=hf_...
SUBGRAPH_URL_ETH=https://api.studio.thegraph.com/query/.../h-swarm-eth/version/latest
SUBGRAPH_URL_BASE=https://api.studio.thegraph.com/query/.../hswarm-base/version/latest
SUBGRAPH_URL_ARB=https://api.studio.thegraph.com/query/.../hswarn-test/version/latest
SUBGRAPH_URL_BNB=https://api.studio.thegraph.com/query/.../h-swarm-bnb/version/latest
PRIVATE_KEY=0x...
ARBITRUM_MAINNET_RPC_URL=https://...
```

### Install & Run

```bash
# Install backend dependencies
npm install

# Terminal 1 — API backend
node server.js

# Terminal 2 — Frontend dev server
cd frontend && npm install && npm run dev
```

Then open [http://localhost:5173](http://localhost:5173)

---

## Project Structure

```
src/                  — Pipeline (discovery, audit, standardization)
  indexer/            — ERC-8004 subgraph fetcher & IPFS resolver
  orchestrator/       — Auditor, LLM standardizer, database layer
contracts/            — Solidity vault contracts (Foundry)
frontend/             — React/Vite web app (wagmi + WalletConnect)
scripts/              — Development & test utilities
server.js             — REST API backend for the frontend
init_db.js            — Database bootstrap script
HSwarm.md             — Full protocol documentation
```

---

## Deployment

| Service | URL |
|---------|-----|
| Frontend (Vercel) | [https://h-swarm.vercel.app](https://h-swarm.vercel.app) |
| Backend API (Render) | [https://hswarm.onrender.com](https://hswarm.onrender.com) |
