import React, { useState, useEffect, Component } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, ArrowRight, Users } from 'lucide-react';
import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';

class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ border: '1px solid #FF2A2A44', background: '#0A0000', padding: '24px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', color: '#FF2A2A' }}>
          CARD RENDER ERROR
          <div style={{ color: '#666', fontSize: '0.65rem', marginTop: '8px' }}>{String(this.state.error?.message || 'Unknown')}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

const VAULT_ABI = [
  { name: 'totalAssets',       type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'strategyName',      type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string'  }] },
  { name: 'lastRebalanced',    type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'rebalanceInterval', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

async function loadFormations() {
  try { const r = await fetch('/api/formations'); const d = await r.json(); return d.formations || []; } catch { return []; }
}

const PURPOSE_LABELS: Record<string, string> = { VAULT: 'VAULT', VISUAL: 'VISUAL', ARBITRAGE: 'ARBITRAGE', SUPERAGENT: 'SUPERAGENT' };
const PURPOSE_COLORS: Record<string, string> = { VAULT: '#FF2A2A', VISUAL: '#B64FC8', ARBITRAGE: '#FFCC00', SUPERAGENT: '#00CCFF' };

const RISK_STYLES: Record<string, { color: string; bg: string }> = {
  LOW:    { color: '#00FF66', bg: 'rgba(0,255,102,0.08)'  },
  MEDIUM: { color: '#FFCC00', bg: 'rgba(255,204,0,0.08)'  },
  HIGH:   { color: '#FF2A2A', bg: 'rgba(255,42,42,0.08)'  },
};

function Chip({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '0.5rem',
      padding: '2px 8px',
      background: bg,
      border: `1px solid ${color}`,
      color,
      letterSpacing: '1px',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function StatusBadge({ deployed }: { deployed: boolean }) {
  if (deployed) {
    return <Chip label="LIVE" color="#00FF66" bg="rgba(0,255,102,0.08)" />;
  }
  return <Chip label="PENDING DEPLOYMENT" color="#FFCC00" bg="rgba(255,204,0,0.06)" />;
}

function VaultProductCard({ product }: { product: any }) {
  const VAULT_ADDRESS = product.contract_address as `0x${string}` | undefined;
  const sharedQuery = { enabled: !!VAULT_ADDRESS };

  const { data: totalAssets } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'totalAssets',
    query: { refetchInterval: 10_000, enabled: !!VAULT_ADDRESS },
  });

  const { data: strategyName } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'strategyName',
    query: sharedQuery,
  });

  const { data: lastRebalanced } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'lastRebalanced',
    query: sharedQuery,
  });

  const { data: rebalanceInterval } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'rebalanceInterval',
    query: sharedQuery,
  });

  const bp    = product.blueprint_json || {};
  const sName = (strategyName as string) || bp.strategy_name || 'HSwarm Vault';
  const tvl   = totalAssets
    ? `$${parseFloat(formatUnits(totalAssets as bigint, 6)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';

  const nextRebalanceIn = (lastRebalanced && rebalanceInterval)
    ? Math.max(0, Math.round((Number(lastRebalanced) + Number(rebalanceInterval) - Date.now() / 1000) / 3600))
    : null;

  const lastRebalancedStr = lastRebalanced
    ? new Date(Number(lastRebalanced) * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  const riskLevel = (bp.risk_level as string | undefined)?.toUpperCase() || null;
  const riskStyle = riskLevel ? (RISK_STYLES[riskLevel] ?? { color: '#888', bg: 'rgba(136,136,136,0.08)' }) : null;
  const chain     = (bp.chain as string | undefined)?.toUpperCase() || 'ARBITRUM';

  const allocs      = (bp.allocations || []) as Array<{ protocol: string; target_pct_bps: number }>;
  const ALLOC_COLORS = ['#B64FC8', '#00CCFF', '#00FF66', '#FF2A2A'];

  return (
    <div style={{ border: '1px solid #2A2A2A', background: '#050505', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 24px', flex: 1, display: 'flex', flexDirection: 'column' }}>

        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color: '#FF2A2A', letterSpacing: '2px' }}>
            ERC-4626 VAULT
          </div>
          <StatusBadge deployed={!!VAULT_ADDRESS} />
        </div>

        {/* Strategy name */}
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 900, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sName}
        </div>

        {/* Sub-line */}
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#555', marginBottom: '12px' }}>
          {product.product_id.substring(0, 8)} · {bp.chain || 'Arbitrum'}
        </div>

        {/* Metadata badge row */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {nextRebalanceIn !== null && (
            <Chip label={`NEXT IN: ${nextRebalanceIn}h`} color="#00CCFF" bg="rgba(0,204,255,0.07)" />
          )}
          {riskStyle && riskLevel && (
            <Chip label={`RISK: ${riskLevel}`} color={riskStyle.color} bg={riskStyle.bg} />
          )}
          <Chip label={`CHAIN: ${chain}`} color="#888" bg="rgba(136,136,136,0.06)" />
        </div>

        {/* TVL */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', color: '#444', letterSpacing: '1px', marginBottom: '2px' }}>TVL</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.2rem', fontWeight: 900, color: '#FFFFFF' }}>{tvl}</div>
        </div>

        {/* Last rebalanced */}
        {lastRebalancedStr && (
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', color: '#444', letterSpacing: '1px', marginBottom: '2px' }}>LAST REBALANCED</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#888' }}>{lastRebalancedStr}</div>
          </div>
        )}

        {/* Allocation bars */}
        {allocs.length > 0 && (
          <div style={{ marginBottom: 'auto' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', color: '#444', letterSpacing: '1px', marginBottom: '8px' }}>ALLOCATIONS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {allocs.map((a, i) => {
                const pct = parseFloat((a.target_pct_bps / 100).toFixed(1));
                const clr = ALLOC_COLORS[i % ALLOC_COLORS.length];
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.52rem', color: '#AAA' }}>{a.protocol}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.52rem', color: clr }}>{pct}%</span>
                    </div>
                    <div style={{ width: '100%', height: '3px', background: '#111', borderRadius: '1px' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: clr, borderRadius: '1px', transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {allocs.length === 0 && <div style={{ marginBottom: 'auto' }} />}
      </div>

      <Link to={`/product/${product.product_id}`} style={{ textDecoration: 'none', display: 'block' }}>
        <button
          style={{ width: '100%', background: '#FF2A2A', color: '#FFFFFF', border: 'none', padding: '12px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', fontWeight: 700, letterSpacing: '2px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#CC1F1F')}
          onMouseLeave={e => (e.currentTarget.style.background = '#FF2A2A')}>
          [ MANAGE ] <ArrowRight size={13} />
        </button>
      </Link>
    </div>
  );
}

function VisualProductCard({ product }: { product: any }) {
  const bp = product.blueprint_json || {};
  const consensus = bp.consensus_decision || { action: 'UNKNOWN', target_protocol: 'Unknown', confidence_score: 0 };

  return (
    <div style={{ border: '1px solid #2A2A2A', background: '#050505', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 24px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color: '#B64FC8', letterSpacing: '2px' }}>
            VISUAL ANALYTICS
          </div>
          <StatusBadge deployed={true} />
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 900, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {consensus.target_protocol} Dashboard
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#555', marginBottom: '16px' }}>
          {product.product_id.substring(0, 8)} · Session {product.swarm_id?.substring(0, 8)}
        </div>
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', color: '#444', letterSpacing: '1px', marginBottom: '2px' }}>CONFIDENCE</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.2rem', fontWeight: 900, color: '#00FF66' }}>{consensus.confidence_score}%</div>
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#555', lineHeight: 1.5, marginBottom: 'auto' }}>
          {consensus.action} → {consensus.target_protocol}
        </div>
      </div>
      <Link to={`/product/${product.product_id}`} style={{ textDecoration: 'none', display: 'block' }}>
        <button
          style={{ width: '100%', background: '#B64FC8', color: '#FFFFFF', border: 'none', padding: '12px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', fontWeight: 700, letterSpacing: '2px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#9333B0')}
          onMouseLeave={e => (e.currentTarget.style.background = '#B64FC8')}>
          [ VIEW ] <ArrowRight size={13} />
        </button>
      </Link>
    </div>
  );
}

function GenericProductCard({ product }: { product: any }) {
  const bp    = product.blueprint_json || {};
  const label = PURPOSE_LABELS[product.purpose] || product.purpose;
  const c     = PURPOSE_COLORS[product.purpose] || '#888';

  return (
    <div style={{ border: `1px solid ${c}44`, background: '#050505', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 24px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color: c, letterSpacing: '2px' }}>
            {label}
          </div>
          <StatusBadge deployed={!!product.contract_address} />
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 900, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {bp.strategy_name || product.purpose}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#555', marginBottom: '16px' }}>
          {product.product_id.substring(0, 8)} · {new Date(product.created_at).toLocaleDateString()}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#555', lineHeight: 1.5, marginBottom: 'auto', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
          {product.market_summary?.substring(0, 200) || `${label} product built by HSwarm agent consensus pipeline.`}
        </div>
      </div>
      <Link to={`/product/${product.product_id}`} style={{ textDecoration: 'none', display: 'block' }}>
        <button
          style={{ width: '100%', background: c, color: '#000', border: 'none', padding: '12px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', fontWeight: 700, letterSpacing: '2px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: 0.9 }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '0.9')}>
          [ VIEW ] <ArrowRight size={13} />
        </button>
      </Link>
    </div>
  );
}

function ComingSoonBadge() {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', zIndex: 10 }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem', color: '#888', border: '1px solid #888', padding: '8px 20px', letterSpacing: '3px' }}>
        COMING SOON
      </span>
    </div>
  );
}

const COMING_SOON_PURPOSES = new Set(['ARBITRAGE', 'SUPERAGENT']);

function renderProductCard(p: any) {
  const isComingSoon = COMING_SOON_PURPOSES.has(p.purpose);
  if (p.purpose === 'VAULT') return <div style={{ position: 'relative' }}><VaultProductCard product={p} /></div>;
  if (p.purpose === 'VISUAL') return <div style={{ position: 'relative' }}><VisualProductCard product={p} /></div>;
  return (
    <div style={{ position: 'relative' }}>
      <GenericProductCard product={p} />
      {isComingSoon && <ComingSoonBadge />}
    </div>
  );
}

export default function AgenticProducts() {
  const [formations, setFormations] = useState<any[]>([]);
  const [products,   setProducts]   = useState<any[]>([]);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    const refresh = async () => {
      setFormations(await loadFormations());
      try {
        const r = await fetch('/api/products');
        if (!r.ok) { setFetchError(`HTTP ${r.status}`); return; }
        const d = await r.json();
        if (d.products) setProducts(d.products);
        setFetchError('');
      } catch (e: any) {
        setFetchError(e.message || 'Network error');
      }
    };
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  const liveCount    = products.filter(p =>  p.contract_address).length;
  const pendingCount = products.filter(p => !p.contract_address).length;

  return (
    <div style={{ background: '#000000', minHeight: '100vh' }}>
      <div style={{ padding: '32px 48px 28px', borderBottom: '1px solid #2A2A2A' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color: '#555', letterSpacing: '2px', marginBottom: '8px' }}>
              DEPLOYED &amp; OPERATIONAL
            </div>
            <h1 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', fontWeight: 900, color: '#FFFFFF', letterSpacing: '2px', textTransform: 'uppercase', margin: 0 }}>
              AGENTIC PRODUCTS
            </h1>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            {fetchError && (
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color: '#FF2A2A', border: '1px solid #FF2A2A', padding: '4px 10px', letterSpacing: '1px' }}>
                FETCH ERROR: {fetchError}
              </span>
            )}
            {[
              { label: `${products.length} TOTAL`, color: '#888'    },
              { label: `${liveCount} LIVE`,         color: '#00FF66' },
              { label: `${pendingCount} PENDING`,   color: '#FFCC00' },
            ].map(({ label, color }) => (
              <span key={label} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color, border: `1px solid ${color}`, padding: '4px 10px', letterSpacing: '1px' }}>
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: '28px 48px' }}>
        {formations.length > 0 && (
          <div style={{ marginBottom: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <Users size={14} color="#00CCFF" />
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#00CCFF', letterSpacing: '2px' }}>
                PUBLIC FORMATIONS (ENROLLING)
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
              {formations.map((f: any) => (
                <div key={f.id} style={{ border: '1px solid #00CCFF44', background: '#001A22', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#00CCFF', letterSpacing: '1px' }}>ID: {f.id}</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#888' }}>{f.network}</div>
                  </div>
                  <h3 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1rem', color: '#FFFFFF', margin: 0, letterSpacing: '1px' }}>{f.purpose}</h3>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#00CCFF' }}>
                    {f.enrolled_agents.length} / {f.num_agents} AGENTS ENROLLED
                  </div>
                  <div style={{ width: '100%', height: '3px', background: '#000' }}>
                    <div style={{ width: `${(f.enrolled_agents.length / f.num_agents) * 100}%`, height: '100%', background: '#00CCFF' }} />
                  </div>
                  <Link to="/create" style={{ textDecoration: 'none', marginTop: '4px' }}>
                    <button style={{ width: '100%', background: 'transparent', border: '1px solid #00CCFF', color: '#00CCFF', padding: '8px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', cursor: 'pointer', letterSpacing: '1px' }}>
                      [ JOIN FORMATION ]
                    </button>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
          {products.map(p => (
            <ErrorBoundary key={p.product_id}>
              {renderProductCard(p)}
            </ErrorBoundary>
          ))}
          {products.length === 0 && !fetchError && (
            <div style={{ textAlign: 'center', color: '#888', padding: '60px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem', gridColumn: '1 / -1' }}>
              NO PRODUCTS DEPLOYED YET
            </div>
          )}
          {products.length === 0 && fetchError && (
            <div style={{ textAlign: 'center', color: '#FF2A2A', padding: '60px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem', gridColumn: '1 / -1' }}>
              FAILED TO FETCH PRODUCTS: {fetchError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
