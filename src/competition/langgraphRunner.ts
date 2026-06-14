import Database from "better-sqlite3";
import { getCompletedTasks, upsertSwarm, saveAgenticProduct, AgentTaskRow } from "../orchestrator/database";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { randomUUID, createHash } from "crypto";

const HF_CHAT_URL = process.env.API_URL ? process.env.API_URL.replace(/^["']|["']$/g, "") : "https://router.huggingface.co/v1/chat/completions";
const DEFAULT_HF_MODEL = "Qwen/Qwen2.5-72B-Instruct";

// Define the State of our Graph
export const GraphState = Annotation.Root({
    tasks: Annotation<AgentTaskRow[]>(),
    purpose: Annotation<string>(),
    aggregatedData: Annotation<string>(),
    marketSummary: Annotation<string>(),
    blueprintJson: Annotation<string>(),
});

interface PurposeConfig {
    analystPrompt: string;
    strategistPrompt: string;
}

const PURPOSE_TEMPLATES: Record<string, PurposeConfig> = {
    "VAULT": {
        analystPrompt: `You are a DeFi Market Analyst for HSwarm, an AI agent swarm protocol.
Review the aggregated data from the swarm agents (APY and TVL of DeFi pools on Arbitrum/Base).
Your job is to identify the optimal 2-3 protocols for a conservative ERC-4626 vault strategy.
Evaluate:
1. SAFETY: Protocols with highest TVL (>$10M) indicate deep liquidity and lower risk.
2. YIELD: Balance APY against TVL. Avoid pools with APY >20% unless TVL is also very high.
3. CONCENTRATION RISK: No single protocol should exceed 60% of capital.
Summarize your top 2-3 protocol picks with their approximate allocation percentages that sum to 100%.`,
        strategistPrompt: `You are the Lead Strategist for a live ERC-4626 vault on Arbitrum. Based on the Analyst's summary, output a strict machine-executable JSON strategy. This JSON will be used directly to deploy a smart contract. Output ONLY valid JSON, no markdown.

IMPORTANT: Generate highly unique, creative, and distinct "strategy_name" values and allocation weights that reflect slight variations in market sentiment. Do not output the same generic strategy every time.

JSON schema:
{
  "vault_name": "string (e.g. HSwarm Conservative USDC)",
  "strategy_name": "string (e.g. Conservative USDC Yield Optimizer)",
  "risk_level": "LOW" | "MEDIUM" | "HIGH",
  "base_asset": "USDC",
  "chain": "arbitrum",
  "rebalance_interval_hours": number (12, 24, or 48),
  "min_apy_bps": number (e.g. 300 = 3.00%),
  "max_single_protocol_bps": number (max 6000 = 60%),
  "trade_conditions": {
    "enter_when": "string description of entry condition",
    "exit_when": "string description of exit condition"
  },
  "allocations": [
    {
      "rank": number,
      "protocol": "string (Morpho | Aave | Compound | Fluid | GMX)",
      "pool": "string (exact pool name)",
      "target_pct_bps": number (basis points, must sum to 10000 across all allocations),
      "min_apy_bps": number
    }
  ],
  "chainlink_automation": {
    "interval_seconds": number,
    "upkeep_gas_limit": 500000
  }
}`
    },
    "VISUAL": {
        analystPrompt: `You are the Lead Quantitative Risk Analyst for HSP (Hyper Swarm Protocol). 
Review the 'swarm_data' (recommendations from 20 AI agents) and the 'market_context' (DeFi pool metrics: APY, TVL, Status).
Analyze the consensus:
1. Where is the swarm's Master Consensus allocating the capital? Focus on the weight/reputation of the agents.
2. Identify the Risk vs. Reward divergence. Are high-reputation agents choosing the highest APY (Wasabi 12.36%), or the safest deep liquidity (Compound V3 / Morpho Gauntlet)?
3. Identify outlier agents that are voting against the majority.
Summarize these 3 points concisely.`,
        strategistPrompt: `You are a Frontend Quant-Dashboard Architect. Based on the Analyst's summary and the raw data, output a strict JSON blueprint for the 'VISUAL' terminal interface. 

JSON schema: 
{ 
  "terminal_feed": "A short, cyberpunk-style text log of the swarm reaching consensus on capital allocation.",
  "consensus_decision": {
     "action": "string (e.g., DEPOSIT)",
     "target_protocol": "string",
     "target_pool": "string",
     "confidence_score": "number between 0 and 100"
  },
  "widgets": [ 
    { 
      "type": "scatter_plot" | "allocation_treemap" | "agent_divergence_bar", 
      "title": "string", 
      "description": "string",
      "data_points": [ 
        { "label": "string", "x_value": "number", "y_value": "number", "metadata": "string" } 
      ] 
    } 
  ] 
}. 
Output ONLY valid JSON without markdown formatting.`
    },
    "YIELD": {
        analystPrompt: "You are an Aggressive Degen Yield Analyst. Review the aggregated data. Find the absolute highest APYs, regardless of TVL or risk. Summarize the top 5 most aggressive opportunities.",
        strategistPrompt: "You are a Degen Yield Strategist. Based on the Analyst's summary, output a strict JSON blueprint for an aggressive farming contract. JSON schema: { \"strategy_name\": \"string\", \"risk_level\": \"DEGEN\", \"target_pools\": [ { \"protocol\": \"string\", \"asset\": \"string\", \"expected_apy\": number } ] }. Output ONLY valid JSON."
    }
};

export class SwarmLangGraphRunner {
    private db: Database.Database;
    private apiKey: string;
    private model: string;

    constructor(db: Database.Database) {
        this.db = db;
        this.apiKey = (process.env.HF_TOKEN || "").replace(/^["']|["']$/g, "");
        this.model = process.env.HF_MODEL || DEFAULT_HF_MODEL;
    }

    private async callLLM(systemPrompt: string, userMessage: string, maxTokens: number = 500): Promise<string> {
        if (!this.apiKey) throw new Error("HF_TOKEN missing in .env");

        const res = await fetch(HF_CHAT_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage },
                ],
                max_tokens: maxTokens,
                temperature: 0.9,
                stream: false,
            }),
        });

        const text = await res.text();
        if (!res.ok) {
            throw new Error(`LLM Error ${res.status}: ${text.substring(0, 200)}`);
        }

        const data = JSON.parse(text);
        return data.choices?.[0]?.message?.content || "No response";
    }

    // Node 1: Collects and formats all data from the swarm
    private ingestionNode = async (state: typeof GraphState.State) => {
        console.log("[Graph] 📥 IngestionNode: Aggregating data from swarm...");
        const validJson = state.tasks
            .map(t => t.standardized_json)
            .filter(j => j && j !== "null");

        let collectiveData = [];
        for (const j of validJson) {
            try {
                const parsed = JSON.parse(j!);
                if (parsed.opportunities && parsed.opportunities.length > 0) {
                    collectiveData.push(...parsed.opportunities);
                }
            } catch (e) { /* ignore parse errors */ }
        }

        // De-duplicate or simplify if necessary, but for now just stringify
        const aggregatedData = JSON.stringify(collectiveData, null, 2);
        return { aggregatedData };
    };

    // Node 2: Analyzes the collective data based on Purpose
    private analystNode = async (state: typeof GraphState.State) => {
        console.log(`[Graph] 🔍 AnalystNode: Analyzing market conditions for purpose: ${state.purpose}...`);
        if (!state.aggregatedData || state.aggregatedData === "[]") {
            return { marketSummary: "No actionable market data was provided by the swarm." };
        }

        const config = PURPOSE_TEMPLATES[state.purpose] || PURPOSE_TEMPLATES["VAULT"];
        const sysPrompt = config.analystPrompt;
        const userPrompt = `Aggregated Swarm Data:\n\`\`\`json\n${state.aggregatedData.substring(0, 5000)}\n\`\`\``;

        const summary = await this.callLLM(sysPrompt, userPrompt);
        return { marketSummary: summary };
    };

    // Node 3: Synthesizes the machine-readable Blueprint
    private decisionNode = async (state: typeof GraphState.State) => {
        console.log(`[Graph] 🧠 DecisionNode: Formulating final Blueprint for ${state.purpose}...`);
        const config = PURPOSE_TEMPLATES[state.purpose] || PURPOSE_TEMPLATES["VAULT"];
        const sysPrompt = config.strategistPrompt;
        let blueprintJson = await this.callLLM(sysPrompt, `Analyst Summary:\n${state.marketSummary}`, 1200);
        blueprintJson = blueprintJson.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
        
        return { blueprintJson };
    };

    public async runIteration(swarmId: string, purpose: string = "VAULT", network: string = "Arbitrum/Testnet") {
        const tasks = getCompletedTasks(this.db);
        if (tasks.length === 0) {
            throw new Error("No COMPLETED tasks found in database.");
        }

        upsertSwarm(this.db, swarmId, purpose, "{}");

        // Build the StateGraph
        const workflow = new StateGraph(GraphState)
            .addNode("ingest", this.ingestionNode)
            .addNode("analyze", this.analystNode)
            .addNode("decide", this.decisionNode)
            .addEdge("__start__", "ingest")
            .addEdge("ingest", "analyze")
            .addEdge("analyze", "decide")
            .addEdge("decide", "__end__");

        const app = workflow.compile();

        console.log(`\n=== STEP 4: LangGraph Swarm Consensus ===`);
        console.log(`Starting execution for ${tasks.length} agents...`);

        const initialState = {
            tasks,
            purpose,
            aggregatedData: "",
            marketSummary: "",
            blueprintJson: ""
        };

        const finalState = await app.invoke(initialState);

        console.log("\n============================================");
        console.log(`       AGENTIC PRODUCT [${purpose}]       `);
        console.log("============================================");
        console.log("\n📊 MARKET SUMMARY:");
        console.log(finalState.marketSummary);
        console.log(`\n⚙️  EXECUTION BLUEPRINT JSON:`);
        console.log(finalState.blueprintJson);
        console.log("\n============================================");

        const productId = `prod_${randomUUID().slice(0, 8)}`;
        let contractAddress: string | null = null;
        
        try {
            const blueprint = JSON.parse(finalState.blueprintJson);
            const { deployVault } = require("../executor/deployVault");
            contractAddress = await deployVault(blueprint, network);
        } catch (e: any) {
            console.error(`[Graph] [ERR] Smart Contract Deployment failed: ${e.message}`);
        }

        // Save the result to the database!
        saveAgenticProduct(this.db, productId, swarmId, purpose, finalState.marketSummary, finalState.blueprintJson, contractAddress);
    }

    public async runConsensusOnly(purpose: string = "VAULT"): Promise<{ marketSummary: string; blueprintJson: string }> {
        const tasks = getCompletedTasks(this.db);
        if (tasks.length === 0) {
            throw new Error("No COMPLETED tasks found in database to run consensus.");
        }
        return this.executeGraph(tasks, purpose);
    }

    private async executeGraph(tasks: AgentTaskRow[], purpose: string): Promise<{ marketSummary: string; blueprintJson: string }> {
        const workflow = new StateGraph(GraphState)
            .addNode("ingest", this.ingestionNode)
            .addNode("analyze", this.analystNode)
            .addNode("decide", this.decisionNode)
            .addEdge("__start__", "ingest")
            .addEdge("ingest", "analyze")
            .addEdge("analyze", "decide")
            .addEdge("decide", "__end__");

        const app = workflow.compile();

        console.log(`\n=== LangGraph Swarm Consensus [${purpose}] ===`);
        console.log(`Processing ${tasks.length} agents...`);

        const finalState = await app.invoke({ tasks, purpose, aggregatedData: "", marketSummary: "", blueprintJson: "" });
        return { marketSummary: finalState.marketSummary, blueprintJson: finalState.blueprintJson };
    }
}
