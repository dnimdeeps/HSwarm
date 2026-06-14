import { getPendingForLLM, TaskStatus, AgentTaskRow } from './database';
import Database from 'better-sqlite3';

// HF Inference Providers router — OpenAI-compatible chat completions.
// Qwen2.5 supports `json_object` mode but NOT `json_schema` mode.
// We enforce the schema contract via the system prompt instead.
// Override with HF_MODEL env var.
const HF_CHAT_URL = process.env.API_URL ? process.env.API_URL.replace(/^["']|["']$/g, "") : "https://router.huggingface.co/v1/chat/completions";
const DEFAULT_HF_MODEL = "Qwen/Qwen2.5-72B-Instruct";

// json_object and json_schema response_format are NOT supported on the HF router.
// Instead we enforce JSON output via the system prompt + temperature=0.0.
// Qwen2.5 follows these instructions reliably.

// System prompt — defines the exact JSON structure the model must produce.
const SYSTEM_PROMPT = `You are a DeFi Data Standardizer. Your job is to read raw, chaotic output from a DeFi API or AI agent and extract the core market data into a clean JSON format.

Return a JSON object with EXACTLY these two fields:

{
  "opportunities": [
    {
      "protocol": "<Name of the protocol, e.g. Morpho, Aave>",
      "asset": "<Asset or Pair, e.g. USDC, ETH/USDC>",
      "apy": <Number representing APY percentage, or 0 if unknown>,
      "tvl": <Number representing TVL in USD, or 0 if unknown>,
      "type": "<Type of opportunity, e.g. lending, lp, staking>"
    }
  ],
  "summary": "<One concise sentence summarizing the overall data provided>"
}

Rules:
- Extract a MAXIMUM of 5 most important opportunities from the data. Do NOT extract more than 5.
- Keep the extraction very concise to save time.
- If the data has no APY or TVL, just put 0.
- Ensure the JSON is perfectly valid.
- Output ONLY the JSON object. No markdown, no explanations, no extra text.`;

export interface StandardizedMarketData {
    opportunities: {
        protocol: string;
        asset: string;
        apy: number;
        tvl: number;
        type: string;
    }[];
    summary: string;
}

export class LLMStandardizer {
    private db: Database.Database;
    private apiKey: string;
    private model: string;

    constructor(db: Database.Database) {
        this.db = db;
        this.apiKey = (process.env.HF_TOKEN || "").replace(/^["']|["']$/g, "");
        this.model = process.env.HF_MODEL || DEFAULT_HF_MODEL;
        if (!this.apiKey) {
            console.warn("⚠️ Warning: HF_TOKEN not found in .env. LLM Standardization will fail.");
        }
    }

    public async standardizePending() {
        const pending = getPendingForLLM(this.db);
        if (pending.length === 0) {
            console.log("[LLM] No agents pending standardization.");
            return;
        }

        if (!this.apiKey) {
            const msg = "HF_TOKEN missing in .env";
            for (const row of pending) {
                this.setStatus(row.network, row.agent_id, "FAILED", null, msg);
            }
            console.error(`[LLM] ${msg}. Marked ${pending.length} task(s) as FAILED.`);
            return;
        }

        console.log(`\n=== STEP 3: LLM Standardization ===`);
        console.log(`[LLM] Found ${pending.length} raw responses. Sending to Hugging Face (${this.model})...`);

        for (let i = 0; i < pending.length; i++) {
            await this.processRow(pending[i]);
            if (i < pending.length - 1) {
                const remaining = pending.length - i - 1;
                console.log(`[LLM] Waiting 4s before next call... (${remaining} remaining)`);
                await new Promise(r => setTimeout(r, 4_000));
            }
        }

        console.log(`[LLM] Standardization complete.`);
    }

    private buildUserPrompt(rawResponse: string): string {
        // Truncate very large responses to avoid token limit issues (keep first 3000 chars)
        const truncated = rawResponse.length > 3000
            ? rawResponse.substring(0, 3000) + "\n...[truncated]"
            : rawResponse;

        return `Raw DeFi agent output to analyze:
\`\`\`
${truncated}
\`\`\``;
    }

    private async processRow(row: AgentTaskRow, retries = 5): Promise<void> {
        console.log(`[LLM] Standardizing ${row.network}:${row.agent_id}...`);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60_000);

            const res = await fetch(HF_CHAT_URL, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        {
                            role: "system",
                            content: SYSTEM_PROMPT,
                        },
                        {
                            role: "user",
                            content: this.buildUserPrompt(row.raw_response ?? ""),
                        },
                    ],
                    max_tokens: 600,
                    temperature: 0.0,
                    stream: false,
                }),
                signal: controller.signal as any,
            });
            clearTimeout(timeoutId);

            const bodyText = await res.text();

            if (res.status === 429 || res.status === 503) {
                let retryDelay = 10_000;
                try {
                    const data = JSON.parse(bodyText);
                    if (typeof data.estimated_time === "number") {
                        retryDelay = Math.ceil(data.estimated_time * 1000) + 2000;
                    }
                } catch { /* use default delay */ }

                if (retries > 0) {
                    console.log(`[LLM] HF API busy/loading. Waiting ${Math.round(retryDelay / 1000)}s then retrying... (${retries} retries left)`);
                    await new Promise(r => setTimeout(r, retryDelay));
                    return this.processRow(row, retries - 1);
                }
                throw new Error("API busy — all retries exhausted");
            }

            if (!res.ok) {
                console.error(`[LLM] HF API error ${res.status} for ${row.network}:${row.agent_id}`);
                console.error(`[LLM] Response body: ${bodyText.substring(0, 500)}`);
                throw new Error(`API Error ${res.status}: ${bodyText.substring(0, 200)}`);
            }

            const parsed = this.parseChatResponse(bodyText);
            this.setStatus(row.network, row.agent_id, "COMPLETED", JSON.stringify(parsed));
            console.log(`[✓] ${row.network}:${row.agent_id} → Extracted ${parsed.opportunities.length} opportunities`);
        } catch (err: any) {
            const message = err.name === "AbortError" ? "Request timed out after 60s" : err.message;
            console.error(`[✗] ${row.network}:${row.agent_id} LLM Failed: ${message}`);
            this.setStatus(row.network, row.agent_id, "FAILED", null, message);
        }
    }

    private parseChatResponse(bodyText: string): StandardizedMarketData {
        const data = JSON.parse(bodyText);
        const content = data?.choices?.[0]?.message?.content;

        if (!content || typeof content !== "string") {
            console.error(`[LLM] Unexpected response structure: ${bodyText.substring(0, 300)}`);
            throw new Error("No content in chat completion response");
        }

        let raw: any;
        try {
            raw = JSON.parse(content.trim());
        } catch {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try { raw = JSON.parse(jsonMatch[0]); } catch { /* ignore */ }
            }
        }

        if (!raw) throw new Error("Model did not return parseable JSON");

        // Basic validation/fallback
        return {
            opportunities: Array.isArray(raw.opportunities) ? raw.opportunities : [],
            summary: typeof raw.summary === "string" ? raw.summary : "No summary provided.",
        };
    }



    private setStatus(network: string, agent_id: string, status: TaskStatus, standardized_json: string | null, error?: string) {
        this.db.prepare(`
            UPDATE agent_tasks
            SET status = ?, standardized_json = ?, error = COALESCE(?, error), updated_at = datetime('now')
            WHERE network = ? AND agent_id = ?
        `).run(status, standardized_json, error ?? null, network, agent_id);
    }
}


