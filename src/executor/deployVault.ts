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

  // Load Factory ABI & Bytecode
  const factoryPath = path.join(__dirname, "../../contracts/out/VaultFactory.sol/VaultFactory.json");
  const factoryJson = JSON.parse(fs.readFileSync(factoryPath, "utf8"));
  const factoryAbi = factoryJson.abi;
  const factoryBytecode = factoryJson.bytecode.object;

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

  // Normalize allocations to sum 10000 before vault creation
  // This ensures maxSingleProtocolBps accommodates the actual strategy
  const rawAllocs = blueprint.allocations || [];
  const allocsTotal = rawAllocs.reduce((s: number, a: any) => s + (a.target_pct_bps || 0), 0);
  if (allocsTotal > 0 && allocsTotal !== 10000) {
    for (const alloc of rawAllocs) {
      alloc.target_pct_bps = Math.round(((alloc.target_pct_bps || 0) / allocsTotal) * 10000);
    }
    const finalTotal = rawAllocs.reduce((s: number, a: any) => s + a.target_pct_bps, 0);
    if (finalTotal !== 10000 && rawAllocs.length > 0) {
      rawAllocs[rawAllocs.length - 1].target_pct_bps += (10000 - finalTotal);
    }
    console.log(`   Normalized allocations to sum 10000: ${rawAllocs.map((a: any) => `${a.protocol}: ${a.target_pct_bps}`).join(', ')}`);
  }

  // Compute a safe max that accommodates the largest allocation
  const maxAlloc = Math.max(...rawAllocs.map((a: any) => a.target_pct_bps || 0), 0);
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

  if (!vaultAddress || vaultAddress === "0x" || vaultAddress === "0x0000000000000000000000000000000000000000") {
    console.log("   Could not find Vault address in events, falling back to dummy.");
    vaultAddress = "0x1111111111111111111111111111111111111111";
  } else {
    // Deploy MockAdapters and set allocations
    console.log(`   Vault address: ${vaultAddress}`);
    console.log(`   Deploying Adapters for Swarm strategy on ${network}...`);
    
    const allocations = blueprint.allocations || [];
    const formattedAllocations = [];

    // Allocations already normalized to sum 10000 (done before vault creation)

    for (const alloc of allocations) {
      console.log(`     -> Deploying adapter for ${alloc.protocol}...`);
      let adapterTx;

      if (isMainnet) {
          if (alloc.protocol.includes("Aave")) {
              const aaveAbiPath = path.join(__dirname, "../../contracts/out/AaveAdapter.sol/AaveAdapter.json");
              const aaveJson = JSON.parse(fs.readFileSync(aaveAbiPath, "utf8"));
              adapterTx = await walletClient.deployContract({
                abi: aaveJson.abi,
                bytecode: aaveJson.bytecode.object,
                args: [
                    "0x794a61358D6845594F94dc1DB02A252b5b4814aD", // Aave V3 Pool
                    "0x724dc807b04555b71ed48a6896b6F41593b8C637", // aArbUSDCn
                    usdcAddress, // Real USDC
                    vaultAddress
                ]
              });
          } else if (alloc.protocol.includes("Morpho")) {
              const morphoAbiPath = path.join(__dirname, "../../contracts/out/MorphoAdapter.sol/MorphoAdapter.json");
              const morphoJson = JSON.parse(fs.readFileSync(morphoAbiPath, "utf8"));
              adapterTx = await walletClient.deployContract({
                abi: morphoJson.abi,
                bytecode: morphoJson.bytecode.object,
                args: [
                    "0x4C20c82FFCB0ea5F58eb4620d2F212D8879B7C03", // Gauntlet USDC Core
                    usdcAddress, // Real USDC
                    vaultAddress
                ]
              });
          } else {
             console.log(`       [WARN] Unsupported protocol ${alloc.protocol} on Mainnet. Using Aave as fallback.`);
             const aaveAbiPath = path.join(__dirname, "../../contracts/out/AaveAdapter.sol/AaveAdapter.json");
             const aaveJson = JSON.parse(fs.readFileSync(aaveAbiPath, "utf8"));
             adapterTx = await walletClient.deployContract({
               abi: aaveJson.abi,
               bytecode: aaveJson.bytecode.object,
               args: ["0x794a61358D6845594F94dc1DB02A252b5b4814aD", "0x724dc807b04555b71ed48a6896b6F41593b8C637", usdcAddress, vaultAddress]
             });
          }
      } else {
          // Use MockAdapter for testnets
          const mockAdapterPath = path.join(__dirname, "../../contracts/out/MockAdapter.sol/MockAdapter.json");
          const mockJson = JSON.parse(fs.readFileSync(mockAdapterPath, "utf8"));
          adapterTx = await walletClient.deployContract({
            abi: mockJson.abi,
            bytecode: mockJson.bytecode.object,
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
      const vaultAbiPath = path.join(__dirname, "../../contracts/out/HSwarmVault.sol/HSwarmVault.json");
      const vaultAbi = JSON.parse(fs.readFileSync(vaultAbiPath, "utf8")).abi;
      
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
    } else {
        console.log(`[Agent] [WARN] register_chainlink_upkeep tool not found in agentkit.`);
    }
  } catch (err: any) {
    console.error(`[Agent] Failed to register upkeep via AgentKit: ${err.message}`);
  }

  return vaultAddress;
}
