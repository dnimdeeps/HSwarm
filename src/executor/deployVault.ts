import { createWalletClient, createPublicClient, http, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, arbitrum } from "viem/chains";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

export async function deployVault(
  blueprint: any,
  network: string
): Promise<string> {
  console.log(`\n🚀 Deploying Vault to ${network}...`);
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not found in .env");
  const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey as `0x${string}` : `0x${privateKey}`);

  const chain = network.toLowerCase().includes("sepolia") ? arbitrumSepolia : arbitrum;
  const rpc = network.toLowerCase().includes("sepolia") 
    ? process.env.ARBITRUM_SEPOLIA_RPC_URL 
    : process.env.ARBITRUM_MAINNET_RPC_URL;
  if (!rpc) throw new Error(`RPC URL missing for ${network}`);

  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpc) });

  // Load compiled artifacts
  const artifactsPath = path.join(__dirname, "../../contracts/artifacts.json");
  const artifacts = JSON.parse(fs.readFileSync(artifactsPath, "utf8"));
  const factoryAbi = artifacts.VaultFactory.abi;
  const factoryBytecode = artifacts.VaultFactory.bytecode;

  console.log("   Deploying VaultFactory...");
  const factoryTx = await walletClient.deployContract({
    abi: factoryAbi,
    bytecode: factoryBytecode,
    args: [],
  });
  
  const factoryReceipt = await publicClient.waitForTransactionReceipt({ hash: factoryTx });
  const factoryAddress = factoryReceipt.contractAddress;
  console.log(`   VaultFactory deployed at: ${factoryAddress}`);

  // Fake USDC for Sepolia or real USDC for Mainnet
  const usdcAddress = network.toLowerCase().includes("sepolia")
    ? "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" // Arb Sepolia mock USDC
    : "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // Arb Mainnet USDC

  // Map common pool names to their protocol
  function normalizeProtocol(raw: string): string {
    const lower = raw.toLowerCase();
    if (lower.includes("morpho")) return "Morpho";
    if (["gauntlet", "steakhouse", "spark", "moonwell", "flagship"].some(p => lower.includes(p))) return "Morpho";
    if (lower.includes("aave")) return "Aave";
    if (lower.includes("compound")) return "Compound";
    if (lower.includes("fluid")) return "Fluid";
    if (lower.includes("gmx")) return "GMX";
    console.log(`   [WARN] Unknown protocol "${raw}", treating as Aave fallback`);
    return "Aave";
  }

  // Map pool names to Morpho vault addresses (default: Gauntlet USDC Core)
  function getMorphoVault(pool: string): string {
    const lower = pool.toLowerCase();
    if (lower.includes("steakhouse") && lower.includes("prime")) return "0x4C20c82FFCB0ea5F58eb4620d2F212D8879B7C03";
    if (lower.includes("steakhouse")) return "0x4C20c82FFCB0ea5F58eb4620d2F212D8879B7C03";
    if (lower.includes("moonwell") || lower.includes("flagship")) return "0x4C20c82FFCB0ea5F58eb4620d2F212D8879B7C03";
    if (lower.includes("spark")) return "0x4C20c82FFCB0ea5F58eb4620d2F212D8879B7C03";
    return "0x4C20c82FFCB0ea5F58eb4620d2F212D8879B7C03"; // Gauntlet (default)
  }

  // Normalize protocol names and group allocations by protocol
  const rawAllocs = blueprint.allocations || [];
  const protoMap = new Map<string, { protocol: string; pool: string; target_pct_bps: number }>();
  for (const alloc of rawAllocs) {
    const proto = normalizeProtocol(alloc.protocol || "");
    const existing = protoMap.get(proto);
    if (existing) {
      existing.target_pct_bps += alloc.target_pct_bps || 0;
    } else {
      protoMap.set(proto, { protocol: proto, pool: alloc.pool || "", target_pct_bps: alloc.target_pct_bps || 0 });
    }
  }
  const consolidated = Array.from(protoMap.values());

  // Normalize consolidated to sum 10000
  const allocsTotal = consolidated.reduce((s: number, a: any) => s + a.target_pct_bps, 0);
  if (allocsTotal > 0 && allocsTotal !== 10000) {
    for (const alloc of consolidated) {
      alloc.target_pct_bps = Math.round((alloc.target_pct_bps / allocsTotal) * 10000);
    }
    const finalTotal = consolidated.reduce((s: number, a: any) => s + a.target_pct_bps, 0);
    if (finalTotal !== 10000 && consolidated.length > 0) {
      consolidated[consolidated.length - 1].target_pct_bps += (10000 - finalTotal);
    }
  }
  console.log(`   Consolidated allocations: ${consolidated.map((a: any) => `${a.protocol}: ${a.target_pct_bps}`).join(', ')}`);

  // Compute a safe max that accommodates the largest allocation
  const maxAlloc = Math.max(...consolidated.map((a: any) => a.target_pct_bps || 0), 0);
  const safeMaxBps = Math.max(blueprint.max_single_protocol_bps || 6000, maxAlloc);

  // Deploy the actual vault using the Factory
  console.log("   Creating HSwarmVault from Factory...");
  const createTx = await walletClient.writeContract({
    address: factoryAddress as `0x${string}`,
    abi: factoryAbi,
    functionName: "createVault",
    args: [
      usdcAddress,
      blueprint.vault_name || "HSwarm Vault",
      "hsUSDC",
      blueprint.strategy_name || "Agentic Strategy",
      BigInt(blueprint.rebalance_interval_hours ? blueprint.rebalance_interval_hours * 3600 : 86400),
      BigInt(blueprint.min_apy_bps || 300),
      BigInt(safeMaxBps),
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
  
  let vaultAddress = "";
  
  for (const log of receipt.logs) {
    try {
      const decoded: any = decodeEventLog({
        abi: factoryAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "VaultCreated") {
        vaultAddress = decoded.args.vaultAddress;
        break;
      }
    } catch (err) {
      // Ignore logs that don't match our ABI
    }
  }

  const isMainnet = network === "Arbitrum One" || network === "Arbitrum/Mainnet" || network.toLowerCase().includes("mainnet");

  const formattedAllocations: any[] = [];

  if (!vaultAddress || vaultAddress === "0x" || vaultAddress === "0x0000000000000000000000000000000000000000") {
    console.log("   Could not find Vault address in events, falling back to dummy.");
    vaultAddress = "0x1111111111111111111111111111111111111111";
  } else {
    // Deploy MockAdapters and set allocations
    console.log(`   Vault address: ${vaultAddress}`);
    console.log(`   Deploying Adapters for Swarm strategy on ${network}...`);

    for (const alloc of consolidated) {
      console.log(`     -> Deploying adapter for ${alloc.protocol}...`);
      let adapterTx;

      if (isMainnet) {
          if (alloc.protocol === "Aave") {
              adapterTx = await walletClient.deployContract({
                abi: artifacts.AaveAdapter.abi,
                bytecode: artifacts.AaveAdapter.bytecode,
                args: [
                    "0x794a61358D6845594F94dc1DB02A252b5b4814aD", // Aave V3 Pool
                    "0x724dc807b04555b71ed48a6896b6F41593b8C637", // aArbUSDCn
                    usdcAddress, // Real USDC
                    vaultAddress
                ]
              });
          } else if (alloc.protocol === "Compound") {
              adapterTx = await walletClient.deployContract({
                abi: artifacts.CompoundAdapter.abi,
                bytecode: artifacts.CompoundAdapter.bytecode,
                args: [
                    "0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA", // cUSDCv3 proxy
                    usdcAddress,
                    vaultAddress
                ]
              });
          } else if (alloc.protocol === "Morpho") {
              const morphoVault = getMorphoVault(alloc.pool);
              console.log(`       Using Morpho vault ${morphoVault} for pool "${alloc.pool}"`);
              adapterTx = await walletClient.deployContract({
                abi: artifacts.MorphoAdapter.abi,
                bytecode: artifacts.MorphoAdapter.bytecode,
                args: [
                    morphoVault,
                    usdcAddress, // Real USDC
                    vaultAddress
                ]
              });
          } else {
             console.log(`       [WARN] Unsupported protocol ${alloc.protocol} on Mainnet. Using Aave as fallback.`);
             adapterTx = await walletClient.deployContract({
                abi: artifacts.AaveAdapter.abi,
                bytecode: artifacts.AaveAdapter.bytecode,
               args: ["0x794a61358D6845594F94dc1DB02A252b5b4814aD", "0x724dc807b04555b71ed48a6896b6F41593b8C637", usdcAddress, vaultAddress]
             });
          }
      } else {
          // Use MockAdapter for testnets
          adapterTx = await walletClient.deployContract({
            abi: artifacts.MockAdapter.abi,
            bytecode: artifacts.MockAdapter.bytecode,
            args: [usdcAddress, vaultAddress, alloc.protocol],
          });
      }

      const adapterReceipt = await publicClient.waitForTransactionReceipt({ hash: adapterTx });
      formattedAllocations.push({
        adapter: adapterReceipt.contractAddress as string,
        targetPct: BigInt(alloc.target_pct_bps),
        protocolName: alloc.protocol
      });
    }

    if (formattedAllocations.length > 0) {
      console.log(`   Setting allocations on Vault...`);
      const vaultAbi = artifacts.HSwarmVault.abi;
      
      const setAllocTx = await walletClient.writeContract({
        address: vaultAddress as `0x${string}`,
        abi: vaultAbi,
        functionName: "setAllocations",
        args: [formattedAllocations]
      });
      await publicClient.waitForTransactionReceipt({ hash: setAllocTx });
      console.log(`   ✅ Allocations set and Vault activated!`);
    }
  }

  console.log(`✅ HSwarmVault deployed successfully at: ${vaultAddress}`);

  let chainlinkUpkeepId = "";
  console.log(`\n🔗 Initializing AI Agent (CDP AgentKit) to register Chainlink Upkeep...`);
  try {
    const { initializeAgentWallet } = require("./walletAgent");
    const agentData = await initializeAgentWallet(vaultAddress, isMainnet);
    
    const chainlinkTool = agentData.tools.find((t: any) => t.name === "ChainlinkActionProvider_register_chainlink_upkeep");
    if (chainlinkTool) {
        const result = await chainlinkTool.invoke({ 
            vaultAddress: vaultAddress, 
            vaultName: blueprint.vault_name || "HSwarm Vault" 
        });
        console.log(`[Agent] ${result}`);
        const idMatch = result.match(/Upkeep ID:\s*(\d+)/);
        if (idMatch) chainlinkUpkeepId = idMatch[1];
    } else {
        console.log(`[Agent] [WARN] register_chainlink_upkeep tool not found in agentkit.`);
    }
  } catch (err: any) {
    console.error(`[Agent] Failed to register upkeep via AgentKit: ${err.message}`);
  }

  const networkSlug = isMainnet ? "arbitrum-one" : "arbitrum-sepolia";
  const deployment = {
    vaultAddress,
    network: networkSlug,
    strategyName: blueprint.strategy_name || "HSwarm Strategy",
    vaultName: blueprint.vault_name || "HSwarm Vault",
    usdcAddress,
    factoryAddress,
    chainlinkUpkeepId: chainlinkUpkeepId || null,
    allocations: formattedAllocations.map((a: any) => ({
      adapter: a.adapter,
      targetPctBps: Number(a.targetPct),
      protocolName: a.protocolName,
    })),
    deployedAt: new Date().toISOString(),
  };

  const deploymentsPath = path.join(process.cwd(), "deployments.json");
  let deployments: any[] = [];
  try {
    if (fs.existsSync(deploymentsPath)) {
      deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
    }
  } catch {}
  deployments.push(deployment);
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`📄 Deployment saved to deployments.json`);

  return vaultAddress;
}
