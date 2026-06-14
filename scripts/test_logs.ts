import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const rpc = process.env.ARBITRUM_SEPOLIA_RPC_URL;
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc) });
  
  const receipt = await publicClient.getTransactionReceipt({ hash: "0xb7a109a13a268b375b486fcb20c217cf2315cb8da3efbe6a0904d98cd29cb403" as `0x${string}` });
  console.log(JSON.stringify(receipt.logs, null, 2));
}

main();
