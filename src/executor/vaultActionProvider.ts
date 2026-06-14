import { z } from "zod";
import { ActionProvider, CreateAction } from "@coinbase/agentkit";
import { EvmWalletProvider } from "@coinbase/agentkit";
import { encodeFunctionData } from "viem";

const vaultAbi = [
    {
        type: "function",
        name: "rebalance",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "setAllocations",
        inputs: [
            {
                type: "tuple[]",
                components: [
                    { type: "address", name: "adapter" },
                    { type: "uint256", name: "targetPct" },
                    { type: "string", name: "protocolName" }
                ],
                name: "_allocations"
            }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    }
] as const;

export class VaultActionProvider extends ActionProvider<EvmWalletProvider> {
    private vaultAddress: string;

    constructor(vaultAddress: string) {
        super("hswarm_vault", []);
        this.vaultAddress = vaultAddress;
    }

    @CreateAction({
        name: "rebalance_vault",
        description: "Manually triggers a rebalance of the HSwarmVault, causing it to fetch the optimal allocation from the Stylus contract and move funds accordingly. Use this when the strategy changes or APY shifts significantly.",
        schema: z.object({}) as any,
    })
    async rebalanceVault(walletProvider: EvmWalletProvider, args: any): Promise<string> {
        console.log(`🤖 Agent is rebalancing Vault at ${this.vaultAddress}...`);
        try {
            const data = encodeFunctionData({
                abi: vaultAbi,
                functionName: "rebalance",
            });

            const hash = await walletProvider.sendTransaction({
                to: this.vaultAddress as `0x${string}`,
                data,
            });
            
            await walletProvider.waitForTransactionReceipt(hash);
            return `Successfully rebalanced vault! Transaction Hash: ${hash}`;
        } catch (error: any) {
            return `Failed to rebalance vault: ${error.message}`;
        }
    }

    @CreateAction({
        name: "set_allocations",
        description: "Updates the hardcoded allocations for the vault. Use this if the Stylus automated rebalancer is disabled and you need to manually push a new Swarm consensus.",
        schema: z.object({
            allocations: z.array(z.object({
                adapter: z.string().describe("The smart contract address of the adapter (e.g. Aave or Morpho)"),
                targetPct: z.number().describe("The target percentage in basis points (e.g. 5000 = 50%)"),
                protocolName: z.string().describe("Human readable name of the protocol")
            }))
        }) as any,
    })
    async setAllocations(walletProvider: EvmWalletProvider, args: any): Promise<string> {
        console.log(`🤖 Agent is setting new allocations for Vault...`);
        try {
            const data = encodeFunctionData({
                abi: vaultAbi,
                functionName: "setAllocations",
                args: [args.allocations]
            });

            const hash = await walletProvider.sendTransaction({
                to: this.vaultAddress as `0x${string}`,
                data,
            });
            
            await walletProvider.waitForTransactionReceipt(hash);
            return `Successfully updated vault allocations! Transaction Hash: ${hash}`;
        } catch (error: any) {
            return `Failed to set allocations: ${error.message}`;
        }
    }

    supportsNetwork = () => true;
}

export function createVaultActionProvider(vaultAddress: string) {
    return new VaultActionProvider(vaultAddress);
}
