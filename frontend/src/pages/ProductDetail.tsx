import React, { useState, useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, ExternalLink, Network, Bot, Workflow } from 'lucide-react';
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits, decodeEventLog } from 'viem';
import ReactMarkdown from 'react-markdown';

const API = import.meta.env.VITE_API_URL || '';

// ─── ABI ──────────────────────────────────────────────────────────────────────

const VAULT_ABI = [
  // View functions
  { name: 'totalAssets',          type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalSupply',          type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'strategyName',         type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'lastRebalanced',       type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'rebalanceInterval',    type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'minApyThresholdBps',   type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'maxSingleProtocolBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf',            type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'convertToAssets',      type: 'function', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  // Write functions
  { name: 'deposit',  type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  // Events
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
  {
    name: 'AllocationUpdated', type: 'event',
    inputs: [
      { name: 'adapter',   type: 'address', indexed: true },
      { name: 'targetPct', type: 'uint256', indexed: false },
    ],
  },
] as const;

const ERC20_ABI = [
  { name: 'approve',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view',       inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view',       inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

// ─── Types ─────────────────────────────────────────────────────────────────────

type TxStep = 'IDLE' | 'APPROVING' | 'DEPOSITING' | 'WITHDRAWING' | 'SUCCESS' | 'ERROR';

interface ParsedEvent {
  type: 'Deposit' | 'Withdraw' | 'Rebalanced' | 'AllocationUpdated';
  hash: string;
  block: number;
  amountUsdc?: string;
  totalAssets?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductDetail() {
  const { id } = useParams();
  const { address } = useAccount();

  const [mode,    setMode]    = useState<'DEPOSIT' | 'WITHDRAW'>('DEPOSIT');
  const [amount,  setAmount]  = useState('');
  const [txStep,  setTxStep]  = useState<TxStep>('IDLE');
  const [txHash,  setTxHash]  = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [copied,  setCopied]  = useState(false);

  const [dbProduct, setDbProduct] = useState<any>(null);
  const [weights,   setWeights]   = useState<any[]>([]);
  const [events,    setEvents]    = useState<ParsedEvent[]>([]);

  // ── Fetch product + weights ──────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/products/${id}`)
      .then(r => r.json())
      .then(d => {
        if (!d.error) {
          setDbProduct(d);
          if (d.swarm_id) {
            fetch(`${API}/api/weights/${d.swarm_id}`)
              .then(wr => wr.json())
              .then(wd => { if (wd.weights) setWeights(wd.weights); })
              .catch(console.error);
          }
        }
      })
      .catch(console.error);
  }, [id]);

  // ── Derived constants ────────────────────────────────────────────────────────
  const VAULT_ADDRESS = (dbProduct?.contract_address || undefined) as `0x${string}` | undefined;
  const isVisual  = dbProduct?.purpose === 'VISUAL';
  const isMainnet = dbProduct?.blueprint_json?.chain?.toLowerCase().includes('mainnet') ?? false;

  const USDC_ADDRESS = (isMainnet
    ? '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
    : '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d') as `0x${string}`;

  const arbiscanBase = isMainnet
    ? 'https://arbiscan.io'
    : 'https://sepolia.arbiscan.io';

  const networkLabel = isMainnet ? 'LIVE \xB7 ARBITRUM MAINNET' : 'LIVE \xB7 ARBITRUM SEPOLIA';

  // ── Inscribed state ──────────────────────────────────────────────────────────
  const [isInscribed, setIsInscribed] = useState(false);

  useEffect(() => {
    if (id) {
      const inscribed = JSON.parse(localStorage.getItem('hswarm_inscribed') || '[]');
      setIsInscribed(inscribed.includes(id));
    }
  }, [id]);

  const handleInscribe = () => {
    if (!id) return;
    const inscribed = JSON.parse(localStorage.getItem('hswarm_inscribed') || '[]');
    if (!inscribed.includes(id)) {
      inscribed.push(id);
      localStorage.setItem('hswarm_inscribed', JSON.stringify(inscribed));
      setIsInscribed(true);
    } else {
      const updated = inscribed.filter((x: string) => x !== id);
      localStorage.setItem('hswarm_inscribed', JSON.stringify(updated));
      setIsInscribed(false);
    }
  };

  // ── VISUAL product early return ───────────────────────────────────────────────
  if (isVisual && dbProduct) {
    return (
      <div style={{ background: '#000000', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', padding: '16px 32px', borderBottom: '1px solid #2A2A2A', background: '#020202' }}>
          <Link to="/products" style={{ color: '#555', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ArrowLeft size={16} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', letterSpacing: '1px' }}>PRODUCTS</span>
          </Link>
          <span style={{ color: '#2A2A2A' }}>|</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', color: '#FFFFFF', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
              {dbProduct.blueprint_json?.consensus_decision?.target_protocol || 'VISUAL'} ANALYTICS
            </span>
          </div>
          <button
            onClick={handleInscribe}
            style={{
              background: isInscribed ? 'transparent' : '#B64FC8',
              color: isInscribed ? '#B64FC8' : '#FFF',
              border: '1px solid #B64FC8',
              padding: '6px 16px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.65rem',
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: '1px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {isInscribed ? '\u2713 INSCRIBED' : '+ INSCRIBE (FREE)'}
          </button>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', padding: '5px 12px', background: 'rgba(182,79,200,0.1)', border: '1px solid #B64FC8', color: '#B64FC8', marginLeft: '12px' }}>
            VISUAL ANALYTICS
          </span>
        </div>
        <div style={{ flex: 1, position: 'relative' }}>
          {!isInscribed && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.2rem', color: '#FFF', marginBottom: '16px', letterSpacing: '2px' }}>SUBSCRIPTION REQUIRED</div>
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '0.9rem', color: '#888', marginBottom: '24px', maxWidth: '400px', textAlign: 'center', lineHeight: 1.6 }}>This visual product is completely free. Inscribe to your account to unlock the real-time swarm analytics dashboard.</div>
              <button onClick={handleInscribe} style={{ background: '#B64FC8', color: '#FFF', border: 'none', padding: '12px 32px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '2px' }}>UNLOCK NOW</button>
            </div>
          )}
          <iframe
            src={`${API}/api/visual/${id}`}
            style={{ width: '100%', height: 'calc(100vh - 65px)', border: 'none' }}
            title="Visual Dashboard"
            onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
          />
        </div>
      </div>
    );
  }

  // ── Wagmi hooks — all gated with enabled so undefined address never throws ─────

  const { data: totalAssets, refetch: refetchAssets } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'totalAssets',
    query: { refetchInterval: 5000, enabled: !!VAULT_ADDRESS },
  });

  const { data: strategyName } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'strategyName',
    query: { enabled: !!VAULT_ADDRESS },
  });

  const { data: lastRebalanced } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'lastRebalanced',
    query: { enabled: !!VAULT_ADDRESS },
  });

  const { data: rebalanceInterval } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'rebalanceInterval',
    query: { enabled: !!VAULT_ADDRESS },
  });

  const { data: minApyBps } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'minApyThresholdBps',
    query: { enabled: !!VAULT_ADDRESS },
  });

  const { data: maxSingleBps } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'maxSingleProtocolBps',
    query: { enabled: !!VAULT_ADDRESS },
  });

  const { data: usdcBalance, refetch: refetchUsdcBal } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { refetchInterval: 5000, enabled: !!address },
  });

  const { data: userShares, refetch: refetchShares } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { refetchInterval: 5000, enabled: !!VAULT_ADDRESS && !!address },
  });

  const { data: userAssets } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'convertToAssets',
    args: userShares ? [userShares as bigint] : undefined,
    query: { refetchInterval: 5000, enabled: !!VAULT_ADDRESS && !!userShares },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && VAULT_ADDRESS ? [address, VAULT_ADDRESS] : undefined,
    query: { enabled: !!address && !!VAULT_ADDRESS },
  });

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  // ── Event log parsing with decodeEventLog ─────────────────────────────────────
  useEffect(() => {
    if (!VAULT_ADDRESS || !publicClient) return;

    const fetchEvents = async () => {
      try {
        const logs = await publicClient.getLogs({
          address: VAULT_ADDRESS as `0x${string}`,
          fromBlock: 'earliest',
          toBlock:   'latest',
        }) as any[];

        const parsed: ParsedEvent[] = [];

        for (const log of logs) {
          try {
            const decoded: any = decodeEventLog({
              abi:    VAULT_ABI as any,
              data:   log.data,
              topics: log.topics,
            });

            if (decoded.eventName === 'Deposit') {
              const args = decoded.args as { assets: bigint; shares: bigint };
              parsed.push({
                type:       'Deposit',
                hash:       log.transactionHash ?? '',
                block:      Number(log.blockNumber ?? 0n),
                amountUsdc: parseFloat(formatUnits(args.assets, 6)).toFixed(4),
              });
            } else if (decoded.eventName === 'Withdraw') {
              const args = decoded.args as { assets: bigint; shares: bigint };
              parsed.push({
                type:       'Withdraw',
                hash:       log.transactionHash ?? '',
                block:      Number(log.blockNumber ?? 0n),
                amountUsdc: parseFloat(formatUnits(args.assets, 6)).toFixed(4),
              });
            } else if (decoded.eventName === 'Rebalanced') {
              const args = decoded.args as { totalAssets: bigint };
              parsed.push({
                type:        'Rebalanced',
                hash:        log.transactionHash ?? '',
                block:       Number(log.blockNumber ?? 0n),
                totalAssets: parseFloat(formatUnits(args.totalAssets, 6)).toFixed(4),
              });
            } else if (decoded.eventName === 'AllocationUpdated') {
              parsed.push({
                type:  'AllocationUpdated',
                hash:  log.transactionHash ?? '',
                block: Number(log.blockNumber ?? 0n),
              });
            }
          } catch {
            // log doesn't match any known event — skip silently
          }
        }

        setEvents(parsed.reverse());
      } catch (e) {
        console.error('Failed to fetch events', e);
      }
    };

    fetchEvents();
    const interval = setInterval(fetchEvents, 10_000);
    return () => clearInterval(interval);
  }, [VAULT_ADDRESS, publicClient]);

  // ── Derived display values ────────────────────────────────────────────────────
  const tvl              = totalAssets  ? parseFloat(formatUnits(totalAssets  as bigint, 6)).toFixed(4) : '\u2014';
  const userUsdcBal      = usdcBalance  ? parseFloat(formatUnits(usdcBalance  as bigint, 6)).toFixed(4) : '\u2014';
  const userPosition     = userAssets   ? parseFloat(formatUnits(userAssets   as bigint, 6)).toFixed(4) : '0';
  const lastRebalancedDate = lastRebalanced ? new Date(Number(lastRebalanced) * 1000).toLocaleString() : '\u2014';
  const nextRebalanceDate  = (lastRebalanced && rebalanceInterval)
    ? new Date((Number(lastRebalanced) + Number(rebalanceInterval)) * 1000).toLocaleString()
    : '\u2014';
  const minApy    = minApyBps    ? (Number(minApyBps)    / 100).toFixed(2) + '%' : (dbProduct?.blueprint_json?.min_apy_bps    ? (dbProduct.blueprint_json.min_apy_bps    / 100).toFixed(2) + '%' : '\u2014');
  const maxSingle = maxSingleBps ? (Number(maxSingleBps) / 100).toFixed(0) + '%' : (dbProduct?.blueprint_json?.max_single_protocol_bps ? (dbProduct.blueprint_json.max_single_protocol_bps / 100).toFixed(0) + '%' : '\u2014');
  const sName = (strategyName as string) || dbProduct?.blueprint_json?.strategy_name || 'HSWARM VAULT';
  const allocs = dbProduct?.blueprint_json?.allocations || [];

  // ── Real weight totals ────────────────────────────────────────────────────────
  const totalWeight = useMemo(
    () => weights.reduce((sum: number, w: any) => sum + Number(w.weight), 0),
    [weights],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleCopy = () => {
    if (!VAULT_ADDRESS) return;
    navigator.clipboard.writeText(VAULT_ADDRESS);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDeposit = async () => {
    if (!amount || !address || !VAULT_ADDRESS) return;
    setTxError(null);
    setTxHash(null);
    try {
      const parsedAmount = parseUnits(amount, 6);
      const currentAllowance = (allowance as bigint) || 0n;
      if (currentAllowance < parsedAmount) {
        setTxStep('APPROVING');
        // @ts-ignore
        const approveTx = await writeContractAsync({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: 'approve', args: [VAULT_ADDRESS, parsedAmount] });
        setTxHash(approveTx);
        await new Promise(res => setTimeout(res, 3000));
        await refetchAllowance();
      }
      setTxStep('DEPOSITING');
      // @ts-ignore
      const depositTx = await writeContractAsync({ address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: 'deposit', args: [parsedAmount, address] });
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
    if (!amount || !address || !VAULT_ADDRESS) return;
    setTxError(null);
    setTxHash(null);
    try {
      const parsedAmount = parseUnits(amount, 6);
      setTxStep('WITHDRAWING');
      // @ts-ignore
      const withdrawTx = await writeContractAsync({ address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: 'withdraw', args: [parsedAmount, address, address] });
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
    IDLE:        mode === 'DEPOSIT' ? '[ EXECUTE DEPOSIT ]' : '[ EXECUTE WITHDRAW ]',
    APPROVING:   '[ APPROVING USDC... ]',
    DEPOSITING:  '[ DEPOSITING... ]',
    WITHDRAWING: '[ WITHDRAWING... ]',
    SUCCESS:     '[ \u2713 TRANSACTION CONFIRMED ]',
    ERROR:       '[ RETRY ]',
  }[txStep];

  // ── Event display helpers ─────────────────────────────────────────────────────
  const eventLabel = (ev: ParsedEvent): string => {
    switch (ev.type) {
      case 'Deposit':           return `[DEPOSIT] $${ev.amountUsdc} USDC`;
      case 'Withdraw':          return `[WITHDRAW] $${ev.amountUsdc} USDC`;
      case 'Rebalanced':        return `[REBALANCED] Total Assets: $${ev.totalAssets} USDC`;
      case 'AllocationUpdated': return '[ALLOCATION UPDATED]';
      default:                  return '[EVENT]';
    }
  };

  const eventColor = (ev: ParsedEvent): string => {
    switch (ev.type) {
      case 'Deposit':           return '#00FF66';
      case 'Withdraw':          return '#FF2A2A';
      case 'Rebalanced':        return '#00CCFF';
      case 'AllocationUpdated': return '#FFCC00';
      default:                  return '#888';
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: '#000000', minHeight: '100vh' }}>
      <style>{`
        @keyframes pulse-green { 0%,100%{box-shadow:0 0 0px #00FF66} 50%{box-shadow:0 0 12px rgba(0,255,102,0.4)} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .markdown p { margin-top:0; margin-bottom:12px; line-height:1.6; color:#777; }
        .markdown h3, .markdown h4 { margin-top:24px; margin-bottom:12px; color:#FFF; font-family:'JetBrains Mono',monospace; font-size:0.9rem; text-transform:uppercase; letter-spacing:1px; }
        .markdown ul, .markdown ol { margin-top:0; margin-bottom:16px; padding-left:20px; color:#777; }
        .markdown li { margin-bottom:8px; line-height:1.6; }
        .markdown strong { color:#FFF; }
      `}</style>

      {/* ── Top bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px', padding: '16px 32px', borderBottom: '1px solid #2A2A2A', background: '#020202' }}>
        <Link to="/products" style={{ color: '#555', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ArrowLeft size={16} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', letterSpacing: '1px' }}>PRODUCTS</span>
        </Link>
        <span style={{ color: '#2A2A2A' }}>|</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', color: '#FFFFFF', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
            {sName}
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#444' }}>
            {VAULT_ADDRESS ? `${VAULT_ADDRESS.substring(0, 10)}...${VAULT_ADDRESS.substring(36)}` : 'ADDRESS NOT SET'}
          </span>
          {VAULT_ADDRESS && (
            <>
              <button onClick={handleCopy} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                <Copy size={12} color={copied ? '#00FF66' : '#444'} />
              </button>
              <a href={`${arbiscanBase}/address/${VAULT_ADDRESS}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={12} color="#444" />
              </a>
            </>
          )}
        </div>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.6rem',
          padding: '5px 12px',
          background: VAULT_ADDRESS ? 'rgba(0,255,102,0.1)' : 'rgba(255,204,0,0.1)',
          border: `1px solid ${VAULT_ADDRESS ? '#00FF66' : '#FFCC00'}`,
          color: VAULT_ADDRESS ? '#00FF66' : '#FFCC00',
          animation: VAULT_ADDRESS ? 'pulse-green 2s infinite' : 'none',
        }}>
          {VAULT_ADDRESS ? networkLabel : 'IN DEVELOPMENT'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', minHeight: 'calc(100vh - 57px)' }}>

        {/* ════ LEFT ════ */}
        <div style={{ borderRight: '1px solid #2A2A2A' }}>

          {/* ── Stat cards row 1 ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '1px solid #2A2A2A' }}>
            {[
              { label: 'TOTAL VALUE LOCKED', value: `$${tvl}`, sub: 'USDC' },
              {
                label: 'REBALANCE INTERVAL',
                value: rebalanceInterval
                  ? `${(Number(rebalanceInterval) / 3600).toFixed(0)}h`
                  : (dbProduct?.blueprint_json?.rebalance_interval_hours ? `${dbProduct.blueprint_json.rebalance_interval_hours}h` : '\u2014'),
                sub: 'hours',
              },
              { label: 'MIN APY THRESHOLD',   value: minApy,    sub: 'per year' },
              { label: 'MAX SINGLE PROTOCOL', value: maxSingle, sub: 'allocation cap' },
            ].map(({ label, value, sub }) => (
              <div key={label} style={{ padding: '24px', borderRight: '1px solid #2A2A2A', background: '#050505' }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem', color: '#555', letterSpacing: '1px', marginBottom: '8px' }}>{label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.6rem', fontWeight: 900, color: '#FFFFFF', lineHeight: 1 }}>{value}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#444', marginTop: '4px' }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* ── Stat cards row 2 — LAST / NEXT REBALANCE ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', borderBottom: '1px solid #2A2A2A' }}>
            {[
              { label: 'LAST REBALANCED', value: lastRebalancedDate, sub: 'on-chain' },
              { label: 'NEXT REBALANCE',  value: nextRebalanceDate,  sub: 'automated' },
            ].map(({ label, value, sub }) => (
              <div key={label} style={{ padding: '20px 24px', borderRight: '1px solid #2A2A2A', background: '#030303' }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem', color: '#555', letterSpacing: '1px', marginBottom: '8px' }}>{label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.95rem', fontWeight: 700, color: '#FFFFFF', lineHeight: 1 }}>{value}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#444', marginTop: '4px' }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* ── On-chain strategy configuration ── */}
          <div style={{ padding: '32px', borderBottom: '1px solid #2A2A2A' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#666', letterSpacing: '2px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Network size={14} color="#FF2A2A" /> ON-CHAIN STRATEGY CONFIGURATION
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ background: '#070707', border: '1px solid #1A1A1A', padding: '20px' }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#555', marginBottom: '8px' }}>STRATEGY NAME</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', color: '#FFFFFF', fontWeight: 700 }}>{sName}</div>
              </div>
              <div style={{ background: '#070707', border: '1px solid #1A1A1A', padding: '20px' }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#555', marginBottom: '8px' }}>BASE ASSET</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', color: '#FFFFFF', fontWeight: 700 }}>USDC (6 decimals)</div>
              </div>
              <div style={{ background: '#070707', border: '1px solid #1A1A1A', padding: '20px' }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#555', marginBottom: '8px' }}>PROTOCOL ADAPTERS</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem', color: '#00CCFF' }}>
                  {allocs.length > 0 ? allocs.map((a: any) => a.protocol).join(' + ') : 'Aave V3 + Morpho'}
                </div>
              </div>
              <div style={{ background: '#070707', border: '1px solid #1A1A1A', padding: '20px' }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#555', marginBottom: '8px' }}>AUTOMATION</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem', color: '#FFFFFF' }}>Chainlink Keeper</div>
              </div>
            </div>
          </div>

          {/* ── Swarm consensus ── */}
          {dbProduct && (
            <div style={{ padding: '32px', borderBottom: '1px solid #2A2A2A', background: '#020202' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#666', letterSpacing: '2px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Bot size={14} color="#00FF66" /> SWARM CONSENSUS &amp; AGENT PARTICIPATION
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: '#2A2A2A', marginBottom: '32px' }}>
                {[
                  { label: 'SWARM ID',         val: dbProduct.swarm_id },
                  { label: 'CREATION DATE',    val: new Date(dbProduct.created_at).toLocaleString() },
                  { label: 'CONSENSUS TARGET', val: allocs.length > 0 ? allocs.map((a: any) => a.protocol).join(', ') : (dbProduct.blueprint_json?.consensus_decision?.target_protocol || 'Multiple Protocols') },
                  { label: 'CONFIDENCE SCORE', val: dbProduct.blueprint_json?.consensus_decision?.confidence_score ? `${dbProduct.blueprint_json.consensus_decision.confidence_score}%` : 'High' },
                ].map(({ label, val }) => (
                  <div key={label} style={{ background: '#0A0A0A', padding: '16px 20px' }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem', color: '#555', marginBottom: '4px', letterSpacing: '1px' }}>{label}</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, color: '#FFFFFF' }}>{val}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '32px' }}>
                {/* Left: feeds + summary + allocation bars */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#555', letterSpacing: '2px', marginBottom: '12px' }}>SWARM TERMINAL FEED</div>
                  <div style={{ padding: '16px', background: '#000', borderLeft: '4px solid #10b981', color: '#10b981', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', lineHeight: 1.6, marginBottom: '24px' }}>
                    {'> '}{dbProduct.blueprint_json?.terminal_feed || 'Swarm consensus reached. High-reputation agents recommend optimal yield routing based on selected protocols...'}
                  </div>

                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#555', letterSpacing: '2px', marginBottom: '12px' }}>MARKET SUMMARY BY AGENTS</div>
                  <div className="markdown" style={{ fontSize: '0.85rem', fontFamily: "'Outfit', sans-serif" }}>
                    <ReactMarkdown>{dbProduct.market_summary || 'No summary available.'}</ReactMarkdown>
                  </div>

                  {/* Allocation bar chart — real percentages from target_pct_bps */}
                  {allocs.length > 0 && (
                    <>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#555', letterSpacing: '2px', marginBottom: '12px', marginTop: '24px' }}>
                        PROTOCOL ALLOCATION TARGETS
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {allocs.map((a: any, i: number) => {
                          const pct = (a.target_pct_bps / 100).toFixed(1);
                          const colors = ['#FF2A2A', '#00FF66', '#00CCFF', '#FFCC00', '#B64FC8'];
                          const barColor = colors[i % colors.length];
                          return (
                            <div key={i}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', marginBottom: '6px' }}>
                                <span style={{ color: '#CCC' }}>{a.protocol}</span>
                                <span style={{ color: '#FFFFFF', fontWeight: 700 }}>{pct}%</span>
                              </div>
                              <div style={{ width: '100%', height: '6px', background: '#1A1A1A', borderRadius: '2px' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: '2px', transition: 'width 0.6s ease' }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                {/* Right: real agent weight bars */}
                <div style={{ width: '300px', flexShrink: 0 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#555', letterSpacing: '2px', marginBottom: '12px' }}>AGENT WEIGHT DISTRIBUTION</div>
                  <div style={{ background: '#050505', border: '1px solid #1A1A1A', padding: '16px' }}>
                    {weights.length > 0 ? (
                      <>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#444', marginBottom: '16px', lineHeight: 1.6 }}>
                          Showing top {Math.min(weights.length, 8)} agents by consensus weight.
                        </div>
                        {weights.slice(0, 8).map((w: any, idx: number) => {
                          const rawWeight  = Number(w.weight);
                          const pctOfTotal = totalWeight > 0 ? ((rawWeight / totalWeight) * 100).toFixed(1) : '0.0';
                          const barWidth   = totalWeight > 0 ? `${(rawWeight / totalWeight) * 100}%` : '0%';
                          const isTop      = idx < 3;
                          return (
                            <div key={w.agent_id ?? idx} style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem' }}>
                                <span style={{ color: isTop ? '#00FF66' : '#888' }}>
                                  {w.agent_id ? `Agent-${String(w.agent_id).substring(0, 8)}` : `Agent-${idx + 1}`}
                                </span>
                                <span style={{ color: '#FFFFFF', fontWeight: 700 }}>{pctOfTotal}%</span>
                              </div>
                              <div style={{ width: '100%', height: '4px', background: '#1A1A1A' }}>
                                <div style={{ width: barWidth, height: '100%', background: isTop ? '#00FF66' : '#555', transition: 'width 0.6s ease' }} />
                              </div>
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <div style={{ color: '#555', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', lineHeight: 1.8 }}>
                        No agent weight data available for this swarm yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Execution flow ── */}
          <div style={{ padding: '32px', borderBottom: '1px solid #2A2A2A' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#666', letterSpacing: '2px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Workflow size={14} color="#888" /> EXECUTION FLOW
            </div>
            <p style={{ fontSize: '0.85rem', color: '#666', lineHeight: 1.8, fontFamily: "'Outfit', sans-serif", maxWidth: '700px' }}>
              When you deposit USDC, you receive vault shares (hsUSDC). These shares represent your proportional
              claim on the vault's assets and automatically accrue yield from the underlying protocols based on the
              consensus strategy defined above. You can withdraw at any time.
            </p>
          </div>

          {/* ── LIVE OPERATIONS LOG ── */}
          <div style={{ padding: '32px', background: '#000' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#00FF66', letterSpacing: '2px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00FF66', animation: 'pulse-green 2s infinite' }} />
              LIVE ON-CHAIN OPERATIONS
            </div>

            {events.length === 0 ? (
              <div style={{ color: '#555', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem' }}>
                {VAULT_ADDRESS ? 'Scanning for events...' : 'No contract address configured.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {events.slice(0, 12).map((ev, i) => (
                  <div
                    key={i}
                    style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '16px', background: '#050505', border: '1px solid #1A1A1A', padding: '12px 16px', alignItems: 'center' }}
                  >
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: eventColor(ev), fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {eventLabel(ev)}
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      tx:{' '}
                      <a
                        href={`${arbiscanBase}/tx/${ev.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#666', textDecoration: 'underline' }}
                      >
                        {ev.hash ? `${ev.hash.substring(0, 10)}...${ev.hash.substring(58)}` : '\u2014'}
                      </a>
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem', color: '#444', whiteSpace: 'nowrap' }}>
                      Block {ev.block}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ════ RIGHT — Deposit / Withdraw panel ════ */}
        <div style={{ display: 'flex', flexDirection: 'column', background: '#020202' }}>

          {address && (
            <div style={{ padding: '24px', borderBottom: '1px solid #2A2A2A', background: '#040404' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#555', letterSpacing: '1px', marginBottom: '12px' }}>YOUR POSITION</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: '#1A1A1A' }}>
                {[
                  { label: 'WALLET USDC',    value: `$${userUsdcBal}` },
                  { label: 'IN VAULT (USDC)', value: `$${userPosition}` },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: '#070707', padding: '12px' }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem', color: '#444', marginBottom: '4px' }}>{label}</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.9rem', fontWeight: 700, color: '#FFFFFF' }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', borderBottom: '1px solid #2A2A2A' }}>
            {(['DEPOSIT', 'WITHDRAW'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setAmount(''); setTxStep('IDLE'); setTxError(null); }}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  borderBottom: mode === m ? '2px solid #FF2A2A' : '2px solid transparent',
                  color: mode === m ? '#FFFFFF' : '#555',
                  padding: '16px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.75rem',
                  letterSpacing: '2px',
                  cursor: 'pointer',
                }}
              >
                [{mode === m ? 'X' : ' '}] {m}
              </button>
            ))}
          </div>

          <div style={{ padding: '24px', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#555', letterSpacing: '1px' }}>
              {mode === 'DEPOSIT' ? 'AMOUNT TO DEPOSIT (USDC)' : 'AMOUNT TO WITHDRAW (USDC)'}
            </div>

            <div style={{ position: 'relative' }}>
              <input
                type="number"
                value={amount}
                onChange={e => { setAmount(e.target.value); setTxStep('IDLE'); setTxError(null); }}
                placeholder="0.00"
                disabled={isProcessing || !address || !VAULT_ADDRESS}
                style={{
                  width: '100%',
                  background: '#000000',
                  border: '1px solid #2A2A2A',
                  color: '#FFFFFF',
                  padding: '16px 60px 16px 16px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '1.8rem',
                  fontWeight: 900,
                  outline: 'none',
                  boxSizing: 'border-box',
                  opacity: VAULT_ADDRESS ? 1 : 0.5,
                }}
                onFocus={e  => (e.target.style.borderColor = '#555')}
                onBlur={e   => (e.target.style.borderColor = '#2A2A2A')}
              />
              <span style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: '#555' }}>
                USDC
              </span>
            </div>

            {mode === 'DEPOSIT' && !!usdcBalance && VAULT_ADDRESS && (
              <div style={{ display: 'flex', gap: '8px' }}>
                {['25', '50', '100'].map(v => (
                  <button
                    key={v}
                    onClick={() => setAmount(v)}
                    style={{ flex: 1, background: 'transparent', border: '1px solid #2A2A2A', color: '#666', padding: '8px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', cursor: 'pointer' }}
                    onMouseEnter={e => { (e.currentTarget.style.borderColor = '#555'); (e.currentTarget.style.color = '#AAA'); }}
                    onMouseLeave={e => { (e.currentTarget.style.borderColor = '#2A2A2A'); (e.currentTarget.style.color = '#666'); }}
                  >
                    ${v}
                  </button>
                ))}
                <button
                  onClick={() => setAmount(userUsdcBal)}
                  style={{ flex: 1, background: 'transparent', border: '1px solid #2A2A2A', color: '#666', padding: '8px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', cursor: 'pointer' }}
                  onMouseEnter={e => { (e.currentTarget.style.borderColor = '#555'); (e.currentTarget.style.color = '#AAA'); }}
                  onMouseLeave={e => { (e.currentTarget.style.borderColor = '#2A2A2A'); (e.currentTarget.style.color = '#666'); }}
                >
                  MAX
                </button>
              </div>
            )}

            {!address ? (
              <div style={{ border: '1px solid #2A2A2A', padding: '18px', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: '#555', letterSpacing: '1px' }}>
                CONNECT WALLET TO INTERACT
              </div>
            ) : !VAULT_ADDRESS ? (
              <div style={{ border: '1px solid #FFCC0044', padding: '18px', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: '#FFCC00', letterSpacing: '1px' }}>
                CONTRACT NOT DEPLOYED YET
              </div>
            ) : (
              <button
                onClick={mode === 'DEPOSIT' ? handleDeposit : handleWithdraw}
                disabled={!amount || isProcessing || txStep === 'SUCCESS'}
                style={{
                  width: '100%',
                  background: txStep === 'SUCCESS' ? '#00FF66' : txStep === 'ERROR' ? '#FF2A2A' : isProcessing ? '#1A1A1A' : '#FF2A2A',
                  color: txStep === 'SUCCESS' ? '#000000' : '#FFFFFF',
                  border: 'none',
                  padding: '18px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  letterSpacing: '2px',
                  cursor: (!amount || isProcessing || txStep === 'SUCCESS') ? 'not-allowed' : 'pointer',
                  opacity: (!amount && txStep === 'IDLE') ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                }}
              >
                {isProcessing && (
                  <span style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#FFFFFF', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                )}
                {stepLabel}
              </button>
            )}

            {txHash && (
              <div style={{ background: '#050505', border: '1px solid #1A1A1A', padding: '12px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem' }}>
                <div style={{ color: '#555', marginBottom: '4px' }}>TRANSACTION HASH:</div>
                <a
                  href={`${arbiscanBase}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#00CCFF', textDecoration: 'none', wordBreak: 'break-all', display: 'flex', alignItems: 'flex-start', gap: '6px' }}
                >
                  {txHash.substring(0, 32)}...
                  <ExternalLink size={10} style={{ flexShrink: 0, marginTop: '2px' }} />
                </a>
              </div>
            )}

            {txError && (
              <div style={{ background: 'rgba(255,42,42,0.05)', border: '1px solid #FF2A2A', padding: '12px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', color: '#FF2A2A' }}>
                \u26A0 {txError}
              </div>
            )}

            <div style={{ marginTop: 'auto', padding: '16px', background: '#050505', border: '1px solid #1A1A1A', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#444', lineHeight: 1.8 }}>
              <div style={{ color: '#555', marginBottom: '8px', letterSpacing: '1px' }}>HOW IT WORKS</div>
              {mode === 'DEPOSIT'
                ? '\u2460 Approve USDC spend \u2192 \u2461 Vault mints hsUSDC shares \u2192 \u2462 Capital deployed to protocols via adapters \u2192 \u2463 Yield accrues'
                : '\u2460 Vault burns your hsUSDC shares \u2192 \u2461 Withdraws USDC from adapters \u2192 \u2462 USDC returned to your wallet'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
