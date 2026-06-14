# HSwarm Protocol

A decentralized, self-healing black-box AI protocol designed to leverage the ERC-8004 Agent Standard.

HSwarm filters, audits, and clusters low-reputation ERC-8004 agents into a single cooperative "black-box" Swarm to execute complex market strategies. It autonomously validates agent health via MCP probing, routes data, standardizes messy agent outputs using Hugging Face Inference (chat completions), and prepares them for a unified on-chain execution.

## 🛠 Prerequisites

1. **Node.js** v18+ 
2. A `.env` file in the root directory containing your API keys and The Graph Query URLs.

### `.env` File Example
```env
# The Graph Studio Query URLs (Ensure you use active deployment endpoints)
SUBGRAPH_URL_ETH="https://api.studio.thegraph.com/query/.../version/latest"
SUBGRAPH_URL_BASE="https://api.studio.thegraph.com/query/.../version/latest"
SUBGRAPH_URL_ARB="https://api.studio.thegraph.com/query/.../version/latest"

# LLM Standardizer — Hugging Face Inference Providers
HF_TOKEN="your-huggingface-token"
# Optional: override default model (meta-llama/Llama-3.1-8B-Instruct)
HF_MODEL="meta-llama/Llama-3.1-8B-Instruct"
```

---

## 🚀 How to Use

The backend is composed of two primary scripts. 

### 1. Build the Global Agent Cache (Optional, but highly recommended)
To avoid pinging slow IPFS nodes every time you search for agents, you can download the global metadata registry of ERC-8004 agents into your local database. 

```bash
npx ts-node src/sync.ts
```
*Select a network (or "All") to systematically fetch all agent IDs and their associated IPFS JSON metadata.*

### 2. Run the Main Swarm Pipeline
This script runs the core end-to-end pipeline (Steps 1 to 3):
1. **Discovery:** Finds agents matching your strict parameters (Live or via Local Cache).
2. **Auditing:** Probes the agents' MCP endpoints using a self-healing auditor that tests 16 protocol/header combinations to verify they are fully responsive.
3. **LLM Standardization:** Feeds your prompt to the active agents, captures their raw outputs, and standardizes their trading intents into a unified JSON schema via the Hugging Face chat completions API.

```bash
npx ts-node src/index.ts
```
*When prompted, select whether you want to search the Live Network (Option 1) or your Local Cache (Option 2).*

---

## 🗄 Database Structure
The protocol operates out of an efficient local SQLite database `swarm_responses.db` which contains 4 tables:

1. **`agent_metadata_cache`**: The massive local index populated by `sync.ts`.
2. **`agent_tasks`**: An ephemeral table that tracks the real-time execution state of the Swarm in the current run (Pending → Fetching → Parsing LLM → Completed).
3. **`valid_agents`**: The persistent "Gold" registry of healthy agents that have successfully passed the MCP protocol audit.
4. **`failed_agents`**: The persistent "Trash" registry of dead, inactive, or OAuth-gated agents (preventing them from slowing down future runs).
