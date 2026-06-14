import { AgentKit, ViemWalletProvider, walletActionProvider, erc20ActionProvider } from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, arbitrum } from "viem/chains";
import * as dotenv from "dotenv";
import { createVaultActionProvider } from "./vaultActionProvider";
import { createChainlinkActionProvider } from "./chainlinkActionProvider";

dotenv.config();

/**
 * Initialize the autonomous Wallet Agent using CDP AgentKit.
 * This gives the AI Swarm the ability to execute on-chain transactions,
 * rebalance the vault, and manage funds.
 */
export async function initializeAgentWallet(vaultAddress?: string, isMainnet: boolean = false) {
    console.log("🤖 Initializing Autonomous AI Wallet (CDP AgentKit)...");

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("PRIVATE_KEY not found in .env");
    }

    // 1. Setup standard Viem Wallet Client
    const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey as `0x${string}` : `0x${privateKey}`);
    const chain = isMainnet ? arbitrum : arbitrumSepolia;
    const rpc = isMainnet ? process.env.ARBITRUM_MAINNET_RPC_URL : process.env.ARBITRUM_SEPOLIA_RPC_URL;

    const walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpc),
    });

    // 2. Wrap it in AgentKit's ViemWalletProvider
    const walletProvider = new ViemWalletProvider(walletClient as any);

    const actionProviders: any[] = [
        walletActionProvider(), // Base wallet actions (get balance, etc)
        erc20ActionProvider(),  // ERC20 token actions (transfer, approve, etc)
        createChainlinkActionProvider(), // Chainlink Automation Registration
    ];

    if (vaultAddress) {
        console.log(`🔗 Linking AI Wallet to Vault at ${vaultAddress}...`);
        actionProviders.push(createVaultActionProvider(vaultAddress));
    }

    // 3. Initialize AgentKit with core action providers (ERC20, Wallet)
    const agentKit = await AgentKit.from({
        walletProvider,
        actionProviders,
    });

    // 4. Expose the AgentKit actions as standard LangChain tools
    const tools = await getLangChainTools(agentKit);

    console.log(`✅ Wallet Agent initialized. Address: ${account.address}`);
    console.log(`🛠️  Loaded ${tools.length} on-chain tools for the AI Swarm.`);

    return {
        agentKit,
        tools,
        walletAddress: account.address,
    };
}
