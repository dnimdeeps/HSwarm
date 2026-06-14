import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { arbitrumSepolia, arbitrum } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as dotenv from "dotenv";
dotenv.config();

const pk = process.env.PRIVATE_KEY;
const account = privateKeyToAccount((pk!.startsWith("0x") ? pk : "0x" + pk) as any);

const sepoliaClient = createPublicClient({ chain: arbitrumSepolia, transport: http(process.env.ARBITRUM_SEPOLIA_RPC_URL) });
const mainnetClient = createPublicClient({ chain: arbitrum, transport: http(process.env.ARBITRUM_MAINNET_RPC_URL) });

const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

async function check() {
    const sepLink = "0xb1D4538B4571d411F07960EF2838Ce337FE1E80E";
    const mainLink = "0xf97f4df75154ae1ab22dd63660a92cd8e5302dbf";

    const sepBal = await sepoliaClient.readContract({ address: sepLink, abi, functionName: 'balanceOf', args: [account.address] });
    const mainBal = await mainnetClient.readContract({ address: mainLink, abi, functionName: 'balanceOf', args: [account.address] });

    console.log("Arbitrum Sepolia LINK:", formatUnits(sepBal as bigint, 18));
    console.log("Arbitrum Mainnet LINK:", formatUnits(mainBal as bigint, 18));
}
check();
