import Database from "better-sqlite3";
import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { SwarmLangGraphRunner } from "../competition/langgraphRunner";
import { initializeAgentWallet } from "../executor/walletAgent";
import * as dotenv from "dotenv";

dotenv.config();

const VAULT_READ_ABI = [
  {
    type: "function",
    name: "getAllocationsCount",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAllocation",
    inputs: [{ type: "uint256", name: "index" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { type: "address", name: "adapter" },
          { type: "uint256", name: "targetPct" },
          { type: "string", name: "protocolName" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "strategyName",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
] as const;

interface OnChainAllocation {
  adapter: `0x${string}`;
  targetPct: bigint;
  protocolName: string;
}

interface BlueprintAllocation {
  protocol: string;
  pool: string;
  target_pct_bps: number;
  min_apy_bps?: number;
}

interface VaultProductRow {
  product_id: string;
  swarm_id: string;
  purpose: string;
  market_summary: string;
  blueprint_json: string;
  contract_address: string;
  created_at: string;
}

const BPS_DIFF_THRESHOLD = 100; // 1% — only trigger if allocations differ by more than this

export class SwarmKeeper {
  private db: Database.Database;
  private runner: SwarmLangGraphRunner;
  private intervalMs: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastTickLog = "";

  constructor(db: Database.Database, intervalMs: number = 120_000) {
    this.db = db;
    this.runner = new SwarmLangGraphRunner(db);
    this.intervalMs = intervalMs;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get status(): string {
    return this.running ? "running" : "stopped";
  }

  get lastLog(): string {
    return this.lastTickLog;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[Keeper] Starting keeper loop every ${this.intervalMs}ms...`);
    this.tick();
    this.intervalId = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log("[Keeper] Stopped.");
  }

  async tick(): Promise<void> {
    if (!this.running) return;
    try {
      console.log("[Keeper] Tick — evaluating deployed vaults...");
      const vaults = this.getDeployedVaults();
      if (vaults.length === 0) {
        this.lastTickLog = "No deployed vaults found.";
        console.log(`[Keeper] ${this.lastTickLog}`);
        return;
      }

      console.log(`[Keeper] Running LangGraph consensus...`);
      const consensus = await this.runner.runConsensusOnly("VAULT");
      let blueprint: any;
      try {
        blueprint = JSON.parse(consensus.blueprintJson);
      } catch {
        this.lastTickLog = "Failed to parse consensus blueprint.";
        console.error(`[Keeper] ${this.lastTickLog}`);
        return;
      }

      const newAllocs: BlueprintAllocation[] = blueprint.allocations || [];
      if (newAllocs.length === 0) {
        this.lastTickLog = "Blueprint has no allocations. Skipping.";
        console.log(`[Keeper] ${this.lastTickLog}`);
        return;
      }

      for (const vault of vaults) {
        console.log(`[Keeper] Checking vault ${vault.product_id} at ${vault.contract_address}...`);
        try {
          await this.evaluateVault(vault, newAllocs);
        } catch (e: any) {
          console.error(`[Keeper] Error evaluating vault ${vault.product_id}: ${e.message}`);
        }
      }

      this.lastTickLog = `Tick complete. Evaluated ${vaults.length} vault(s).`;
      console.log(`[Keeper] ${this.lastTickLog}`);
    } catch (e: any) {
      this.lastTickLog = `Tick error: ${e.message}`;
      console.error(`[Keeper] ${this.lastTickLog}`);
    }
  }

  private getDeployedVaults(): VaultProductRow[] {
    return this.db
      .prepare(
        `SELECT * FROM agentic_products WHERE purpose = 'VAULT' AND contract_address IS NOT NULL ORDER BY created_at DESC`
      )
      .all() as VaultProductRow[];
  }

  private async evaluateVault(
    vault: VaultProductRow,
    newAllocs: BlueprintAllocation[]
  ): Promise<void> {
    const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL;
    if (!rpcUrl) {
      console.warn(`[Keeper] ARBITRUM_SEPOLIA_RPC_URL not set. Skipping on-chain check.`);
      return;
    }

    const publicClient = createPublicClient({
      chain: arbitrumSepolia,
      transport: http(rpcUrl),
    });

    const vaultAddress = vault.contract_address as `0x${string}`;

    // Read on-chain allocations
    const countResult = await publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_READ_ABI,
      functionName: "getAllocationsCount",
    });

    const onChainAllocs: OnChainAllocation[] = [];
    const count = Number(countResult);
    for (let i = 0; i < count; i++) {
      const result = await publicClient.readContract({
        address: vaultAddress,
        abi: VAULT_READ_ABI,
        functionName: "getAllocation",
        args: [BigInt(i)],
      });
      const alloc = result as { adapter: `0x${string}`; targetPct: bigint; protocolName: string };
      onChainAllocs.push(alloc);
    }

    // Compare: if count differs or any percentage differs beyond threshold, push update
    const needsUpdate =
      onChainAllocs.length !== newAllocs.length ||
      onChainAllocs.some((onChain, i) => {
        if (i >= newAllocs.length) return true;
        const diff = Math.abs(Number(onChain.targetPct) - newAllocs[i].target_pct_bps);
        return diff > BPS_DIFF_THRESHOLD;
      });

    if (!needsUpdate) {
      console.log(`[Keeper] Vault ${vault.product_id}: allocations unchanged. Skipping.`);
      return;
    }

    console.log(`[Keeper] Vault ${vault.product_id}: allocations changed. Pushing update...`);

    // Build new allocations preserving on-chain adapter addresses but using new percentages
    const updatedAllocs = newAllocs.map((na, i) => {
      const existing = onChainAllocs[i];
      return {
        adapter: existing ? existing.adapter : vaultAddress,
        targetPct: na.target_pct_bps,
        protocolName: existing ? existing.protocolName : na.protocol,
      };
    });

    // If more new allocations than on-chain, fill remaining with vault as adapter (safe fallback)
    while (updatedAllocs.length < onChainAllocs.length) {
      updatedAllocs.push({
        adapter: vaultAddress,
        targetPct: 0,
        protocolName: "idle",
      });
    }

    // Use wallet agent to push the update
    const agent = await initializeAgentWallet(vaultAddress);
    const setAllocTool = agent.tools.find(
      (t: any) => t.name === "set_allocations"
    );
    const rebalanceTool = agent.tools.find(
      (t: any) => t.name === "rebalance_vault"
    );

    if (!setAllocTool || !rebalanceTool) {
      console.error(`[Keeper] Missing required tools (set_allocations / rebalance_vault)`);
      return;
    }

    console.log(`[Keeper] Calling setAllocations with ${updatedAllocs.length} allocation(s)...`);
    const setResult = await setAllocTool.invoke({ allocations: updatedAllocs });
    console.log(`[Keeper] setAllocations result: ${setResult}`);

    console.log(`[Keeper] Calling rebalance...`);
    const rebalanceResult = await rebalanceTool.invoke({});
    console.log(`[Keeper] rebalance result: ${rebalanceResult}`);

    this.lastTickLog = `Updated vault ${vault.product_id}: ${setResult} | ${rebalanceResult}`;
  }
}
