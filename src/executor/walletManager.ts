import { initializeAgentWallet } from "./walletAgent";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { MemorySaver } from "@langchain/langgraph";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Creates an autonomous LangGraph agent equipped with the CDP AgentKit Wallet.
 * This agent can read natural language commands and translate them into
 * on-chain transactions using its tools.
 */
export async function runWalletAgent(vaultAddress: string, taskPrompt: string, isMainnet: boolean = false) {
    // 1. Setup the wallet and get the tools
    const { tools, walletAddress } = await initializeAgentWallet(vaultAddress, isMainnet);

    // 2. Initialize Gemini (the brain of the swarm execution)
    const llm = new ChatGoogleGenerativeAI({
        model: "gemini-2.5-pro",
        apiKey: process.env.GEMINI_API_KEY,
        temperature: 0.1, // Low temperature for precise transaction execution
    });

    // 3. Create the execution agent with memory
    const memory = new MemorySaver();
    const agent = createReactAgent({
        llm: llm as any,
        tools: tools as any,
        checkpointSaver: memory,
        messageModifier: `
          You are the HSwarm Autonomous Execution Agent.
          Your wallet address is: ${walletAddress}.
          You have tools to interact with the blockchain and the HSwarm Vault at ${vaultAddress}.
          Execute the user's task precisely. If you perform an on-chain transaction,
          provide the transaction hash in your final response.
        `,
    });

    console.log(`\n🧠 Giving execution task to Swarm Wallet Agent: "${taskPrompt}"\n`);

    // 4. Run the agent
    const config = { configurable: { thread_id: "hswarm-wallet-agent" } };
    const stream = await agent.stream({ messages: [["user", taskPrompt]] }, config);

    for await (const chunk of stream) {
        if ("agent" in chunk && chunk.agent.messages) {
            console.log("\n--- AGENT THOUGHT ---");
            console.log(JSON.stringify(chunk.agent.messages, null, 2));
        } else if ("tools" in chunk && chunk.tools.messages) {
            console.log("\n--- TOOL OUTPUT ---");
            console.log(JSON.stringify(chunk.tools.messages, null, 2));
        } else {
            console.log("\n--- OTHER ---");
            console.log(JSON.stringify(chunk, null, 2));
        }
    }
}
