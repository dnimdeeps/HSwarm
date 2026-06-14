import { z } from "zod";
import { ActionProvider, CreateAction, EvmWalletProvider } from "@coinbase/agentkit";
import { encodeFunctionData, parseAbi, parseEther, formatEther, Address, getAddress, decodeEventLog, createPublicClient, http } from "viem";
import { arbitrumSepolia, arbitrum } from "viem/chains";

const registrarAbi = [
    {
        "anonymous": false,
        "inputs": [
            { "indexed": true, "internalType": "uint256", "name": "id", "type": "uint256" },
            { "indexed": false, "internalType": "uint32", "name": "performGas", "type": "uint32" },
            { "indexed": false, "internalType": "address", "name": "admin", "type": "address" }
        ],
        "name": "UpkeepRegistered",
        "type": "event"
    },
    {
        "inputs": [
            {
                "components": [
                    { "internalType": "string", "name": "name", "type": "string" },
                    { "internalType": "bytes", "name": "encryptedEmail", "type": "bytes" },
                    { "internalType": "address", "name": "upkeepContract", "type": "address" },
                    { "internalType": "uint32", "name": "gasLimit", "type": "uint32" },
                    { "internalType": "address", "name": "adminAddress", "type": "address" },
                    { "internalType": "uint8", "name": "triggerType", "type": "uint8" },
                    { "internalType": "bytes", "name": "checkData", "type": "bytes" },
                    { "internalType": "bytes", "name": "triggerConfig", "type": "bytes" },
                    { "internalType": "bytes", "name": "offchainConfig", "type": "bytes" },
                    { "internalType": "uint96", "name": "amount", "type": "uint96" }
                ],
                "internalType": "struct RegistrationParams",
                "name": "requestParams",
                "type": "tuple"
            }
        ],
        "name": "registerUpkeep",
        "outputs": [
            { "internalType": "uint256", "name": "upkeepID", "type": "uint256" }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    }
] as const;

const linkAbi = parseAbi([
    "function approve(address spender, uint256 amount) returns (bool)",
    "function balanceOf(address account) view returns (uint256)"
]);

export class ChainlinkActionProvider extends ActionProvider<EvmWalletProvider> {
    constructor() {
        super("chainlink_automation", []);
    }

    @CreateAction({
        name: "register_chainlink_upkeep",
        description: "Registers a smart contract with Chainlink Automation Keepers to run periodically.",
        schema: z.object({
            vaultAddress: z.string().describe("The deployed HSwarmVault contract address to register for upkeep"),
            vaultName: z.string().describe("The name of the vault/strategy")
        }) as any,
    })
    async registerUpkeep(walletProvider: EvmWalletProvider, args: any): Promise<string> {
        console.log(`🤖 Agent is registering Chainlink Automation Upkeep for Vault: ${args.vaultAddress}...`);
        
        try {
            const network = walletProvider.getNetwork();
            const chainId = network.networkId;
            const walletAddress = walletProvider.getAddress();

            let registrarAddress: Address = getAddress("0x881918E24290084409DaA91979A30e6f0dB52eBe"); // Arb Sepolia Automation 2.1 Registrar
            let linkAddress: Address = getAddress("0xb1D4538B4571d411F07960EF2838Ce337FE1E80E"); // Arb Sepolia LINK

            // Arbitrum One Mainnet Chain ID is 42161
            const isMainnet = Number(chainId) === 42161;
            if (isMainnet) {
                registrarAddress = getAddress("0x86EFBD0b6736Bed994962f9797049422A3A8E8Ad"); // Arbitrum One Automation 2.1 Registrar
                linkAddress = getAddress("0xf97f4df75117a78c1a5a0dbb814af92458539fb4"); // Arbitrum One LINK
            }

            // We fund the upkeep with 2 LINK
            const linkAmount = parseEther("2");

            // Check LINK balance before proceeding
            const publicClient = createPublicClient({
                chain: isMainnet ? arbitrum : arbitrumSepolia,
                transport: http(isMainnet ? process.env.ARBITRUM_MAINNET_RPC_URL! : process.env.ARBITRUM_SEPOLIA_RPC_URL!),
            });
            const linkBalance = await publicClient.readContract({
                address: linkAddress,
                abi: linkAbi,
                functionName: "balanceOf",
                args: [getAddress(walletAddress)],
            });
            const faucetUrl = isMainnet ? "https://chain.link" : "https://faucets.chain.link/arbitrum-sepolia";
            if (linkBalance < linkAmount) {
                throw new Error(
                    `Insufficient LINK. Wallet has ${formatEther(linkBalance)} LINK, need at least 2 LINK. ` +
                    `Get test LINK at: ${faucetUrl}`
                );
            }
            console.log(`[Agent] LINK balance: ${formatEther(linkBalance)} LINK ✅`);

            console.log(`[Agent] Approving 2 LINK to Chainlink Registrar ${registrarAddress}...`);
            const approveData = encodeFunctionData({
                abi: linkAbi,
                functionName: "approve",
                args: [registrarAddress, linkAmount]
            });

            const approveHash = await walletProvider.sendTransaction({
                to: linkAddress,
                data: approveData
            });
            await walletProvider.waitForTransactionReceipt(approveHash);
            console.log(`[Agent] Approved LINK. Tx: ${approveHash}`);

            console.log(`[Agent] Calling registerUpkeep...`);
            const requestParams = {
                name: args.vaultName,
                encryptedEmail: "0x" as `0x${string}`,
                upkeepContract: getAddress(args.vaultAddress),
                gasLimit: 1000000, // 1M gas limit for rebalancing
                adminAddress: getAddress(walletAddress),
                triggerType: 0, // Condition based
                checkData: "0x" as `0x${string}`,
                triggerConfig: "0x" as `0x${string}`,
                offchainConfig: "0x" as `0x${string}`,
                amount: linkAmount
            };

            const registerData = encodeFunctionData({
                abi: registrarAbi,
                functionName: "registerUpkeep",
                args: [requestParams]
            });

            const registerHash = await walletProvider.sendTransaction({
                to: registrarAddress,
                data: registerData
            });
            const registerReceipt = await walletProvider.waitForTransactionReceipt(registerHash);

            // Decode UpkeepRegistered event to capture upkeepId
            let upkeepId: string | null = null;
            for (const log of registerReceipt.logs) {
                try {
                    const decoded = decodeEventLog({
                        abi: registrarAbi,
                        data: log.data,
                        topics: log.topics,
                    });
                    if (decoded.eventName === "UpkeepRegistered") {
                        upkeepId = (decoded.args as any).id.toString();
                        break;
                    }
                } catch {}
            }

            const networkSlug = isMainnet ? "arbitrum" : "arbitrum-sepolia";
            if (upkeepId) {
                console.log(`[Agent] ✅ Upkeep registered! ID: ${upkeepId}`);
                console.log(`[Agent] 🔗 Chainlink Automation Dashboard: https://automation.chain.link/${networkSlug}/${upkeepId}`);
            } else {
                console.log(`[Agent] ⚠️ Upkeep registered but could not decode upkeepId from events.`);
            }

            return `✅ Successfully registered Chainlink Upkeep for ${args.vaultName} at address ${args.vaultAddress}! Tx: ${registerHash}${upkeepId ? ` Upkeep ID: ${upkeepId}` : ''}`;
        } catch (error: any) {
            console.error(`[Agent] Error details:`, error);
            return `Failed to register Chainlink Upkeep: ${error.message}`;
        }
    }

    supportsNetwork = () => true;
}

export function createChainlinkActionProvider() {
    return new ChainlinkActionProvider();
}
