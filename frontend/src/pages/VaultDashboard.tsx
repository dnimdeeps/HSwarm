import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits, decodeEventLog, isAddress } from 'viem';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { ArrowLeft, Copy, ExternalLink, Network } from 'lucide-react';

const ARBITRUM_ONE_ID = 42161;
const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const ARBISCAN_BASE = 'https://arbiscan.io';
const CL_DASHBOARD_BASE = 'https://automation.chain.link/arbitrum';

const VAULT_ABI = [
  { name: 'totalAssets',          type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalSupply',          type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'strategyName',         type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'lastRebalanced',       type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'rebalanceInterval',    type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'minApyThresholdBps',   type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'maxSingleProtocolBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf',            type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'convertToAssets',      type: 'function', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'getAllocationsCount',  type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getAllocation',        type: 'function', stateMutability: 'view', inputs: [{ name: 'index', type: 'uint256' }], outputs: [{ type: 'tuple', components: [{ name: 'adapter', type: 'address' }, { name: 'targetPct', type: 'uint256' }, { name: 'protocolName', type: 'string' }] }] },
  { name: 'timeUntilNextRebalance', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'deposit',  type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  {
    name: 'Deposit', type: 'event',
    inputs: [
      { name: 'sender',  type: 'address', indexed: true },
      { name: 'owner',   type: 'address', indexed: true },
      { name: 'assets',  type: 'uint256', indexed: false },
      { name: 'shares',  type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Withdraw', type: 'event',
    inputs: [
      { name: 'sender',   type: 'address', indexed: true },
      { name: 'receiver', type: 'address', indexed: true },
      { name: 'owner',    type: 'address', indexed: true },
      { name: 'assets',   type: 'uint256', indexed: false },
      { name: 'shares',   type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Rebalanced', type: 'event',
    inputs: [
      { name: 'timestamp',   type: 'uint256', indexed: false },
      { name: 'totalAssets', type: 'uint256', indexed: false },
    ],
  },
] as const;

const ERC20_ABI = [
  { name: 'approve',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view',       inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view',       inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

type TxStep = 'IDLE' | 'APPROVING' | 'DEPOSITING' | 'WITHDRAWING' | 'SUCCESS' | 'ERROR';

interface ParsedEvent {
  type: 'Deposit' | 'Withdraw' | 'Rebalanced';
  hash: string;
  block: number;
  amount?: string;
  totalAssets?: string;
}

function VaultDashboard() {
  const { address: vaultAddress } = useParams();
  const { address: userAddress, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const [mode, setMode] = useState<'DEPOSIT' | 'WITHDRAW'>('DEPOSIT');
  const [amount, setAmount] = useState('');
  const [txStep, setTxStep] = useState<TxStep>('IDLE');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [allocations, setAllocations] = useState<{ adapter: string; targetPct: number; protocolName: string }[]>([]);

  const isValidAddr = vaultAddress && isAddress(vaultAddress);
  const VAULT = isValidAddr ? (vaultAddress as `0x${string}`) : undefined;
  const USDC = USDC_ADDRESS as `0x${string}`;

  const { data: totalAssets, refetch: refetchAssets } = useReadContract({
    address: VAULT, abi: VAULT_ABI, functionName: 'totalAssets',
    query: { refetchInterval: 5000, enabled: !!VAULT },
  });
  const { data: totalSupply } = useReadContract({
    address: VAULT, abi: VAULT_ABI, functionName: 'totalSupply',
    query: { refetchInterval: 5000, enabled: !!VAULT },
  });
  const { data: strategyName } = useReadContract({
    address: VAULT, abi: VAULT_ABI, functionName: 'strategyName',
    query: { enabled: !!VAULT },
  });
  const { data: lastRebalanced } = useReadContract({
    address: VAULT, abi: VAULT_ABI, functionName: 'lastRebalanced',
    query: { enabled: !!VAULT },
  });
  const { data: rebalanceInterval } = useReadContract({
    address: VAULT, abi: VAULT_ABI, functionName: 'rebalanceInterval',
    query: { enabled: !!VAULT },
  });
  const { data: minApyBps } = useReadContract({
    address: VAULT, abi: VAULT_ABI, functionName: 'minApyThresholdBps',
    query: { enabled: !!VAULT },
  });
  const { data: maxSingleBps } = useReadContract({
    address: VAULT, abi: VAULT_ABI, functionName: 'maxSingleProtocolBps',
    query: { enabled: !!VAULT },
  });
  const { data: allocCount } = useReadContract({
    address: VAULT, abi: VAULT_ABI, functionName: 'getAllocationsCount',
    query: { enabled: !!VAULT },
  });
  const { data: usdcBalance, refetch: refetchUsdcBal } = useReadContract({
    address: USDC, abi: ERC20_ABI, functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
    query: { refetchInterval: 5000, enabled: !!userAddress },
  });
  const { data: userShares, refetch: refetchShares } = useReadContract({
    address: VAULT, abi: VAULT_ABI, functionName: 'balanceOf',
    args: userAddress && VAULT ? [userAddress] : undefined,
    query: { refetchInterval: 5000, enabled: !!VAULT && !!userAddress },
  });
  const { data: userAssets } = useReadContract({
    address: VAULT, abi: VAULT_ABI, functionName: 'convertToAssets',
    args: userShares ? [userShares as bigint] : undefined,
    query: { refetchInterval: 5000, enabled: !!VAULT && !!userShares },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC, abi: ERC20_ABI, functionName: 'allowance',
    args: userAddress && VAULT ? [userAddress, VAULT] : undefined,
    query: { enabled: !!userAddress && !!VAULT },
  });
  const { data: timeUntilRebalance } = useReadContract({
    address: VAULT, abi: VAULT_ABI, functionName: 'timeUntilNextRebalance',
    query: { refetchInterval: 5000, enabled: !!VAULT },
  });

  const { writeContractAsync } = useWriteContract();

  const sharePrice = useMemo(() => {
    if (totalSupply && totalAssets && (totalSupply as bigint) > 0n) {
      return Number(formatUnits((totalAssets as bigint), 6)) / Number(formatUnits((totalSupply as bigint), 6));
    }
    return 1;
  }, [totalAssets, totalSupply]);

  useEffect(() => {
    if (!allocCount || !VAULT || !publicClient) return;
    const count = Number(allocCount);
    const fetch = async () => {
      const result: { adapter: string; targetPct: number; protocolName: string }[] = [];
      for (let i = 0; i < count; i++) {
        try {
          const alloc = await (publicClient as any).readContract({
            address: VAULT!,
            abi: VAULT_ABI as any,
            functionName: 'getAllocation',
            args: [BigInt(i)],
          }) as { adapter: `0x${string}`; targetPct: bigint; protocolName: string };
          result.push({
            adapter: alloc.adapter,
            targetPct: Number(alloc.targetPct),
            protocolName: alloc.protocolName,
          });
        } catch {}
      }
      setAllocations(result);
    };
    fetch();
  }, [allocCount, VAULT, publicClient]);

  useEffect(() => {
    if (!VAULT || !publicClient) return;
    const fetchEvents = async () => {
      try {
        const logs = await publicClient.getLogs({
          address: VAULT,
          fromBlock: 0x0n,
          toBlock: 'latest',
        }) as any[];
        const parsed: ParsedEvent[] = [];
        for (const log of logs) {
          try {
            const decoded: any = decodeEventLog({ abi: VAULT_ABI as any, data: log.data, topics: log.topics });
            if (decoded.eventName === 'Deposit') {
              const args = decoded.args as { assets: bigint };
              parsed.push({ type: 'Deposit', hash: log.transactionHash ?? '', block: Number(log.blockNumber ?? 0n), amount: parseFloat(formatUnits(args.assets, 6)).toFixed(4) });
            } else if (decoded.eventName === 'Withdraw') {
              const args = decoded.args as { assets: bigint };
              parsed.push({ type: 'Withdraw', hash: log.transactionHash ?? '', block: Number(log.blockNumber ?? 0n), amount: parseFloat(formatUnits(args.assets, 6)).toFixed(4) });
            } else if (decoded.eventName === 'Rebalanced') {
              const args = decoded.args as { totalAssets: bigint };
              parsed.push({ type: 'Rebalanced', hash: log.transactionHash ?? '', block: Number(log.blockNumber ?? 0n), totalAssets: parseFloat(formatUnits(args.totalAssets, 6)).toFixed(4) });
            }
          } catch {}
        }
        setEvents(parsed.reverse());
      } catch {}
    };
    fetchEvents();
    const interval = setInterval(fetchEvents, 10000);
    return () => clearInterval(interval);
  }, [VAULT, publicClient]);

  const tvl = totalAssets ? parseFloat(formatUnits(totalAssets as bigint, 6)).toFixed(4) : '\u2014';
  const userUsdcBal = usdcBalance ? parseFloat(formatUnits(usdcBalance as bigint, 6)).toFixed(4) : '\u2014';
  const userPosition = userAssets ? parseFloat(formatUnits(userAssets as bigint, 6)).toFixed(4) : '0';
  const lastRebalancedDate = lastRebalanced ? new Date(Number(lastRebalanced) * 1000).toLocaleString() : '\u2014';
  const nextRebalanceDate = lastRebalanced && rebalanceInterval
    ? new Date((Number(lastRebalanced) + Number(rebalanceInterval)) * 1000).toLocaleString()
    : '\u2014';
  const sName = (strategyName as string) || 'HSwarm Vault';

  const handleCopy = () => {
    if (!VAULT) return;
    navigator.clipboard.writeText(VAULT);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDeposit = async () => {
    if (!amount || !userAddress || !VAULT) return;
    setTxError(null);
    setTxHash(null);
    try {
      const parsedAmount = parseUnits(amount, 6);
      const currentAllowance = (allowance as bigint) || 0n;
      if (currentAllowance < parsedAmount) {
        setTxStep('APPROVING');
        const approveTx = await writeContractAsync({ address: USDC, abi: ERC20_ABI as any, functionName: 'approve', args: [VAULT, parsedAmount] } as any);
        setTxHash(approveTx);
        await new Promise(res => setTimeout(res, 3000));
        await refetchAllowance();
      }
      setTxStep('DEPOSITING');
      const depositTx = await writeContractAsync({ address: VAULT, abi: VAULT_ABI as any, functionName: 'deposit', args: [parsedAmount, userAddress] } as any);
      setTxHash(depositTx);
      setTxStep('SUCCESS');
      setAmount('');
      setTimeout(() => { refetchAssets(); refetchUsdcBal(); refetchShares(); }, 3000);
    } catch (e: any) {
      setTxStep('ERROR');
      setTxError(e?.shortMessage || e?.message || 'Transaction failed');
    }
  };

  const handleWithdraw = async () => {
    if (!amount || !userAddress || !VAULT) return;
    setTxError(null);
    setTxHash(null);
    try {
      const parsedAmount = parseUnits(amount, 6);
      setTxStep('WITHDRAWING');
      const withdrawTx = await writeContractAsync({ address: VAULT, abi: VAULT_ABI as any, functionName: 'withdraw', args: [parsedAmount, userAddress, userAddress] } as any);
      setTxHash(withdrawTx);
      setTxStep('SUCCESS');
      setAmount('');
      setTimeout(() => { refetchAssets(); refetchUsdcBal(); refetchShares(); }, 3000);
    } catch (e: any) {
      setTxStep('ERROR');
      setTxError(e?.shortMessage || e?.message || 'Transaction failed');
    }
  };

  const isProcessing = txStep === 'APPROVING' || txStep === 'DEPOSITING' || txStep === 'WITHDRAWING';
  const stepLabel = {
    IDLE: mode === 'DEPOSIT' ? '[ EXECUTE DEPOSIT ]' : '[ EXECUTE WITHDRAW ]',
    APPROVING: '[ APPROVING USDC... ]',
    DEPOSITING: '[ DEPOSITING... ]',
    WITHDRAWING: '[ WITHDRAWING... ]',
    SUCCESS: '[ \u2713 CONFIRMED ]',
    ERROR: '[ RETRY ]',
  }[txStep];

  const eventLabel = (ev: ParsedEvent): string => {
    switch (ev.type) {
      case 'Deposit': return `[DEPOSIT] $${ev.amount} USDC`;
      case 'Withdraw': return `[WITHDRAW] $${ev.amount} USDC`;
      case 'Rebalanced': return `[REBALANCED] Assets: $${ev.totalAssets} USDC`;
      default: return '[EVENT]';
    }
  };

  const eventColor = (ev: ParsedEvent): string => {
    switch (ev.type) {
      case 'Deposit': return '#00FF66';
      case 'Withdraw': return '#FF2A2A';
      case 'Rebalanced': return '#00CCFF';
      default: return '#888';
    }
  };

  if (!VAULT) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', background: '#000', fontFamily: "'JetBrains Mono', monospace" }}>
        <div style={{ color: '#FF2A2A', fontSize: '0.9rem' }}>Invalid vault address</div>
      </div>
    );
  }

  return (
    <div style={{ background: '#000000', minHeight: '100vh' }}>
      <style>{`
        @keyframes pulse-green { 0%,100%{box-shadow:0 0 0px #00FF66} 50%{box-shadow:0 0 12px rgba(0,255,102,0.4)} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px', padding: '16px 32px', borderBottom: '1px solid #2A2A2A', background: '#020202' }}>
        <Link to="/products" style={{ color: '#555', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ArrowLeft size={16} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', letterSpacing: '1px' }}>PRODUCTS</span>
        </Link>
        <span style={{ color: '#2A2A2A' }}>|</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', color: '#FFF', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
            {sName}
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#444' }}>
            {VAULT.slice(0, 10)}...{VAULT.slice(36)}
          </span>
          <button onClick={handleCopy} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
            <Copy size={12} color={copied ? '#00FF66' : '#444'} />
          </button>
          <a href={`${ARBISCAN_BASE}/address/${VAULT}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={12} color="#444" />
          </a>
        </div>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', padding: '5px 12px', background: 'rgba(0,255,102,0.1)', border: '1px solid #00FF66', color: '#00FF66', animation: 'pulse-green 2s infinite' }}>
          LIVE \u00B7 ARBITRUM MAINNET
        </span>
        <ConnectButton />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', minHeight: 'calc(100vh - 57px)' }}>

        {/* ════ LEFT ════ */}
        <div style={{ borderRight: '1px solid #2A2A2A' }}>

          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '1px solid #2A2A2A' }}>
            {[
              { label: 'TOTAL VALUE LOCKED', value: `$${tvl}`, sub: 'USDC' },
              { label: 'REBALANCE INTERVAL', value: rebalanceInterval ? `${(Number(rebalanceInterval) / 3600).toFixed(0)}h` : '\u2014', sub: 'hours' },
              { label: 'MIN APY THRESHOLD', value: minApyBps ? `${(Number(minApyBps) / 100).toFixed(2)}%` : '\u2014', sub: 'per year' },
              { label: 'MAX SINGLE PROTOCOL', value: maxSingleBps ? `${(Number(maxSingleBps) / 100).toFixed(0)}%` : '\u2014', sub: 'allocation cap' },
            ].map(({ label, value, sub }) => (
              <div key={label} style={{ padding: '24px', borderRight: '1px solid #2A2A2A', background: '#050505' }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem', color: '#555', letterSpacing: '1px', marginBottom: '8px' }}>{label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', fontWeight: 900, color: '#FFF', lineHeight: 1 }}>{value}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#444', marginTop: '4px' }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* Last / Next rebalance */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', borderBottom: '1px solid #2A2A2A' }}>
            {[
              { label: 'LAST REBALANCED', value: lastRebalancedDate, sub: 'on-chain' },
              { label: 'NEXT REBALANCE', value: nextRebalanceDate, sub: 'automated' },
            ].map(({ label, value, sub }) => (
              <div key={label} style={{ padding: '20px 24px', borderRight: '1px solid #2A2A2A', background: '#030303' }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem', color: '#555', letterSpacing: '1px', marginBottom: '8px' }}>{label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.95rem', fontWeight: 700, color: '#FFF', lineHeight: 1 }}>{value}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#444', marginTop: '4px' }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* Share price */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', borderBottom: '1px solid #2A2A2A' }}>
            <div style={{ padding: '20px 24px', background: '#030303', borderRight: '1px solid #2A2A2A' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem', color: '#555', letterSpacing: '1px', marginBottom: '8px' }}>SHARE PRICE</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.95rem', fontWeight: 700, color: '#00CCFF', lineHeight: 1 }}>${sharePrice.toFixed(6)}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#444', marginTop: '4px' }}>hsUSDC per USDC</div>
            </div>
            <div style={{ padding: '20px 24px', background: '#030303' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem', color: '#555', letterSpacing: '1px', marginBottom: '8px' }}>TIME UNTIL REBALANCE</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.95rem', fontWeight: 700, color: timeUntilRebalance && Number(timeUntilRebalance) === 0 ? '#00FF66' : '#FFF', lineHeight: 1 }}>
                {timeUntilRebalance !== undefined ? `${Math.floor(Number(timeUntilRebalance) / 3600)}h ${Math.floor((Number(timeUntilRebalance) % 3600) / 60)}m` : '\u2014'}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#444', marginTop: '4px' }}>hh:mm</div>
            </div>
          </div>

          {/* Allocations */}
          {allocations.length > 0 && (
            <div style={{ padding: '32px', borderBottom: '1px solid #2A2A2A' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#666', letterSpacing: '2px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Network size={14} color="#00CCFF" /> ON-CHAIN ALLOCATIONS
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {allocations.map((a, i) => {
                  const pct = (a.targetPct / 100).toFixed(1);
                  const colors = ['#00FF66', '#00CCFF', '#FFCC00', '#B64FC8', '#FF2A2A'];
                  const barColor = colors[i % colors.length];
                  return (
                    <div key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', marginBottom: '6px' }}>
                        <span style={{ color: '#CCC' }}>{a.protocolName}</span>
                        <span style={{ color: '#FFF', fontWeight: 700 }}>{pct}%</span>
                      </div>
                      <div style={{ width: '100%', height: '6px', background: '#1A1A1A', borderRadius: '2px' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: '2px', transition: 'width 0.6s ease' }} />
                      </div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color: '#555', marginTop: '4px' }}>
                        Adapter: {a.adapter.slice(0, 10)}...{a.adapter.slice(36)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Chainlink Automation */}
          <div style={{ padding: '32px', borderBottom: '1px solid #2A2A2A' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#666', letterSpacing: '2px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00FF66', animation: 'pulse-green 2s infinite' }} /> CHAINLINK AUTOMATION
            </div>
            <p style={{ fontSize: '0.85rem', color: '#666', lineHeight: 1.8, fontFamily: "'Outfit', sans-serif", maxWidth: '700px' }}>
              This vault is registered with Chainlink Automation. The keeper checks every block if <code style={{ color: '#FFF', background: '#1A1A1A', padding: '2px 6px', borderRadius: '2px' }}>checkUpkeep</code> returns true (rebalance interval elapsed + assets &gt; 0), then calls <code style={{ color: '#FFF', background: '#1A1A1A', padding: '2px 6px', borderRadius: '2px' }}>performUpkeep</code> to cycle capital through protocol adapters.
            </p>
            <a href={`${CL_DASHBOARD_BASE}/${69807263058704082676571068256513945276145989435541215317533139799806854460064}`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '16px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: '#00CCFF', textDecoration: 'underline' }}>
              View on Chainlink Dashboard <ExternalLink size={12} />
            </a>
          </div>

          {/* Event log */}
          <div style={{ padding: '32px', background: '#000' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#00FF66', letterSpacing: '2px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00FF66', animation: 'pulse-green 2s infinite' }} />
              LIVE ON-CHAIN OPERATIONS
            </div>
            {events.length === 0 ? (
              <div style={{ color: '#555', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem' }}>No events yet. Deposit USDC to get started.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {events.slice(0, 12).map((ev, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '16px', background: '#050505', border: '1px solid #1A1A1A', padding: '12px 16px', alignItems: 'center' }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: eventColor(ev), fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {eventLabel(ev)}
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      tx: <a href={`${ARBISCAN_BASE}/tx/${ev.hash}`} target="_blank" rel="noopener noreferrer" style={{ color: '#666', textDecoration: 'underline' }}>{ev.hash.slice(0, 10)}...{ev.hash.slice(58)}</a>
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem', color: '#444', whiteSpace: 'nowrap' }}>Block {ev.block}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ════ RIGHT — Deposit / Withdraw ════ */}
        <div style={{ display: 'flex', flexDirection: 'column', background: '#020202' }}>
          {isConnected && (
            <div style={{ padding: '24px', borderBottom: '1px solid #2A2A2A', background: '#040404' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#555', letterSpacing: '1px', marginBottom: '12px' }}>YOUR POSITION</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: '#1A1A1A' }}>
                {[
                  { label: 'WALLET USDC', value: `$${userUsdcBal}` },
                  { label: 'IN VAULT (USDC)', value: `$${userPosition}` },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: '#070707', padding: '12px' }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem', color: '#444', marginBottom: '4px' }}>{label}</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.9rem', fontWeight: 700, color: '#FFF' }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mode toggle */}
          <div style={{ display: 'flex', borderBottom: '1px solid #2A2A2A' }}>
            {(['DEPOSIT', 'WITHDRAW'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setAmount(''); setTxStep('IDLE'); setTxError(null); }} style={{
                flex: 1, background: 'transparent', border: 'none', borderBottom: mode === m ? '2px solid #FF2A2A' : '2px solid transparent',
                color: mode === m ? '#FFF' : '#555', padding: '16px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', letterSpacing: '2px', cursor: 'pointer',
              }}>
                [{mode === m ? 'X' : ' '}] {m}
              </button>
            ))}
          </div>

          {/* Input + action */}
          <div style={{ padding: '24px', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#555', letterSpacing: '1px' }}>
              {mode === 'DEPOSIT' ? 'AMOUNT TO DEPOSIT (USDC)' : 'AMOUNT TO WITHDRAW (USDC)'}
            </div>
            <div style={{ position: 'relative' }}>
              <input type="number" value={amount} onChange={e => { setAmount(e.target.value); setTxStep('IDLE'); setTxError(null); }} placeholder="0.00" disabled={isProcessing || !userAddress}
                style={{ width: '100%', background: '#000', border: '1px solid #2A2A2A', color: '#FFF', padding: '16px 60px 16px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: '1.8rem', fontWeight: 900, outline: 'none', boxSizing: 'border-box' }}
                onFocus={e => (e.target.style.borderColor = '#555')} onBlur={e => (e.target.style.borderColor = '#2A2A2A')} />
              <span style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: '#555' }}>USDC</span>
            </div>

            {mode === 'DEPOSIT' && !!usdcBalance && (
              <div style={{ display: 'flex', gap: '8px' }}>
                {['25', '50', '100'].map(v => (
                  <button key={v} onClick={() => setAmount(v)}
                    style={{ flex: 1, background: 'transparent', border: '1px solid #2A2A2A', color: '#666', padding: '8px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', cursor: 'pointer' }}>
                    ${v}
                  </button>
                ))}
                <button onClick={() => setAmount(userUsdcBal)}
                  style={{ flex: 1, background: 'transparent', border: '1px solid #2A2A2A', color: '#666', padding: '8px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', cursor: 'pointer' }}>
                  MAX
                </button>
              </div>
            )}

            {!userAddress ? (
              <div style={{ border: '1px solid #2A2A2A', padding: '18px', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: '#555', letterSpacing: '1px' }}>
                CONNECT WALLET TO INTERACT
              </div>
            ) : (
              <button onClick={mode === 'DEPOSIT' ? handleDeposit : handleWithdraw} disabled={!amount || isProcessing || txStep === 'SUCCESS'} style={{
                width: '100%', background: txStep === 'SUCCESS' ? '#00FF66' : txStep === 'ERROR' ? '#FF2A2A' : isProcessing ? '#1A1A1A' : '#FF2A2A',
                color: txStep === 'SUCCESS' ? '#000' : '#FFF', border: 'none', padding: '18px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.82rem',
                fontWeight: 700, letterSpacing: '2px', cursor: (!amount || isProcessing || txStep === 'SUCCESS') ? 'not-allowed' : 'pointer',
                opacity: (!amount && txStep === 'IDLE') ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
              }}>
                {isProcessing && <span style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#FFF', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />}
                {stepLabel}
              </button>
            )}

            {txHash && (
              <div style={{ background: '#050505', border: '1px solid #1A1A1A', padding: '12px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem' }}>
                <div style={{ color: '#555', marginBottom: '4px' }}>TRANSACTION HASH:</div>
                <a href={`${ARBISCAN_BASE}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: '#00CCFF', textDecoration: 'none', wordBreak: 'break-all' }}>
                  {txHash.slice(0, 32)}... <ExternalLink size={10} style={{ display: 'inline' }} />
                </a>
              </div>
            )}

            {txError && (
              <div style={{ background: 'rgba(255,42,42,0.05)', border: '1px solid #FF2A2A', padding: '12px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', color: '#FF2A2A' }}>
                {'\u26A0'} {txError}
              </div>
            )}

            <div style={{ marginTop: 'auto', padding: '16px', background: '#050505', border: '1px solid #1A1A1A', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#444', lineHeight: 1.8 }}>
              <div style={{ color: '#555', marginBottom: '8px', letterSpacing: '1px' }}>HOW IT WORKS</div>
              {mode === 'DEPOSIT'
                ? '\u2460 Approve USDC \u2192 \u2461 Vault mints hsUSDC \u2192 \u2462 Capital deployed to protocols \u2192 \u2463 Yield accrues'
                : '\u2460 Burn hsUSDC shares \u2192 \u2461 Withdraw USDC from adapters \u2192 \u2462 USDC returned to wallet'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VaultDashboard;
