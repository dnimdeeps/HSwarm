import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config();

const pk = process.env.PRIVATE_KEY;
if (!pk) throw "No PK";
const formattedPk = pk.startsWith("0x") ? pk : `0x${pk}`;
const account = privateKeyToAccount(formattedPk as any);
const rpc = process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc) });
const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpc) });

const usdc = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const vault = "0xCE5fFde0Fb93F7101144519F6A090858220186Aa";

const vaultAbi = [
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'totalAssets', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }
];

const usdcAbi = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }
];

async function main() {
    console.log("Checking USDC balance...");
    const bal: any = await publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: 'balanceOf', args: [account.address] });
    console.log(`Bal: ${formatUnits(bal, 6)} USDC`);

    if (bal < parseUnits("1", 6)) {
        console.log("Not enough USDC to test");
        return;
    }

    const amount = parseUnits("1", 6);
    console.log("Approving vault...");
    const hash = await walletClient.writeContract({ address: usdc, abi: usdcAbi, functionName: 'approve', args: [vault, amount] });
    await publicClient.waitForTransactionReceipt({ hash });

    console.log("Depositing 1 USDC into Vault...");
    const depHash = await walletClient.writeContract({ address: vault, abi: vaultAbi, functionName: 'deposit', args: [amount, account.address] });
    await publicClient.waitForTransactionReceipt({ hash: depHash });
    console.log(`Deposited! Tx: ${depHash}`);

    const newTvl: any = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'totalAssets' });
    console.log(`New TVL: ${formatUnits(newTvl, 6)} USDC`);
    
    // Check if USDC is still in the vault
    const vaultUsdcBal: any = await publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: 'balanceOf', args: [vault] });
    console.log(`USDC sitting idle in Vault contract: ${formatUnits(vaultUsdcBal, 6)} USDC`);
}

main().catch(console.error);
