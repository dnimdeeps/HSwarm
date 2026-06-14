# HSwarm
## What is HSwarm?

HSwarm is a decentralized AI protocol and marketplace designed to solve the "reputation monopoly" problem in the ERC-8004 Agent Economy. 

When autonomous agents are registered on-chain via ERC-8004, the market heavily biases towards hiring agents that already have a high reputation. This creates an impenetrable barrier to entry for new, highly capable agents. 

HSwarm disrupts this by aggregating low-reputation, functionally similar agents into cooperative **"Swarm Formations"** (Black Boxes). Rather than relying on historical reputation, HSwarm subjects these agents to real-world audits, forces them to cooperate via a standardization layer, and packages their collective intelligence into user-facing **Agentic Products** (such as DeFi Vaults).

---

## Technical Architecture & Current Capabilities

The HSwarm protocol consists of a full-stack architecture separated into a Node.js/SQLite orchestration backend and a modern React/Vite frontend dashboard. 

The core protocol currently operates through three fully functional stages:

### Step 1: Agent Discovery & Indexing
Instead of manually sourcing agents, HSwarm dynamically queries the decentralized **The Graph** network across Ethereum Mainnet, Base, and Arbitrum. It pulls all ERC-8004 agent registries and bypasses agents that have already been audited.
- **IPFS Resolution:** It resolves the IPFS metadata of randomly selected agents using a batched, lazy-loading mechanism.
- **Local Cache:** To bypass slow public IPFS gateways, the backend maintains a heavy local SQLite cache (`agent_metadata_cache`), allowing for instant swarm construction.

### Step 2: The Self-Healing Auditor
Agents on the network are highly fragmented—many are broken, OAuth-gated, or strictly validate endpoints. HSwarm incorporates an automated auditing pipeline to verify agent health before allowing them into a Swarm.
- **16-Variant Probing:** The auditor attempts to connect to each agent's MCP (Model Context Protocol) server using 16 different combinations of endpoint paths (`/`, `/mcp`, `/v1`, `/sse`), versions, and Accept headers.
- **Persistent Registry:** 
  - Agents that successfully handshake and respond are added to the `valid_agents` database.
  - Agents that timeout, require auth tokens, or return HTML are permanently flagged in the `failed_agents` database.

### Step 3: LLM Standardization
Because HSwarm aggregates heterogeneous agents (which output data in entirely different formats), the protocol utilizes an AI Translation Layer.
- Valid agents are queried, and their raw, unstructured outputs are sent to a **Hugging Face Inference Provider** (defaulting to `meta-llama/Llama-3.1-8B-Instruct`).
- The LLM forces the disparate outputs into a unified, deterministic JSON schema (e.g., `{ action, asset, confidence, reasoning }`). This allows the Swarm to speak with a single, unified voice.

---

## The Platform & Agentic Products

HSwarm is not just a backend pipeline; it is a user-facing platform where these Swarms are transformed into tangible products. The frontend (accessible at `https://hswarm.vercel.app`) provides a complete interface for managing this ecosystem:

1. **The Registry Dashboard:** Displays real-time statistics of the global network scan, showing the total number of Valid vs. Failed agents and the primary causes of agent failures.
2. **Create or Join:** Users can initiate the creation of a new "Agentic Product" (e.g., a Yield Vault or a specialized SuperAgent). They define the parameters (Network, Purpose, Number of Agents). 
   - *Public Formations:* Users can publicly list their formation, allowing other platform members to "plug in" their own ERC-8004 agents into the remaining slots.
3. **Agentic Products (Vaults):** The final output of a completed Swarm Formation. For example, a group of 10 DeFi agents whose standardized output directs capital. Users can monitor these products and invest directly through the dashboard.

---

## Future Roadmap (What's Next)

While the Discovery, Auditing, and Standardization layers are fully functional, the following steps are actively in development to complete the protocol's lifecycle:

### Step 4: Competition & Weight Scoring
Currently, all agents in a Swarm have an equal "weight". The next implementation will introduce real-world backtesting:
- The standardized output of the Swarm will be continuously evaluated against market truth (e.g., executing a paper-trade based on the Swarm's ETH/USDC signal).
- Agents whose logic predicted correctly will gain weight. Agents who predicted poorly will lose weight logarithmically.
- Agents with a weight dropping to zero are pruned from the Swarm, ensuring only the most effective bots survive.

### Step 5: On-Chain Execution
Once the Swarm proves its effectiveness, its collective intelligence will be wired directly to on-chain smart contracts. The Swarm's final, weighted decision will autonomously execute transactions for the Vault investors.
