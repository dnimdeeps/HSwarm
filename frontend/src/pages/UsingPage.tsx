import React, { useEffect, useState, useCallback } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

// ─── Keyframe injection ───────────────────────────────────────────────────────
const KEYFRAMES = `
  @keyframes pulse-green {
    0%, 100% { box-shadow: 0 0 0px #00FF66; opacity: 1; }
    50%       { box-shadow: 0 0 10px rgba(0,255,102,0.5); opacity: 0.6; }
  }
  @keyframes dot-pulse-green {
    0%, 100% { transform: scale(1); opacity: 1; }
    50%       { transform: scale(1.5); opacity: 0.5; }
  }
  @keyframes dot-pulse-purple {
    0%, 100% { transform: scale(1); opacity: 1; }
    50%       { transform: scale(1.5); opacity: 0.5; }
  }
`;

// ─── Chain helpers ────────────────────────────────────────────────────────────
function getExplorerUrl(chain: string | undefined, type: 'address' | 'tx', value: string): string {
  const c = (chain || '').toLowerCase();
  if (c.includes('mainnet') && c.includes('arb')) return `https://arbiscan.io/${type}/${value}`;
  if (c.includes('sepolia') && c.includes('arb')) return `https://sepolia.arbiscan.io/${type}/${value}`;
  if (c.includes('mainnet')) return `https://etherscan.io/${type}/${value}`;
  if (c.includes('sepolia')) return `https://sepolia.etherscan.io/${type}/${value}`;
  return `https://sepolia.arbiscan.io/${type}/${value}`;
}

// ─── VAULT ABI ────────────────────────────────────────────────────────────────
const VAULT_ABI = [
  { name: 'balanceOf',       type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'convertToAssets', type: 'function', stateMutability: 'view', inputs: [{ name: 'shares',  type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'totalAssets',     type: 'function', stateMutability: 'view', inputs: [],                                     outputs: [{ type: 'uint256' }] },
  { name: 'strategyName',    type: 'function', stateMutability: 'view', inputs: [],                                     outputs: [{ type: 'string'  }] },
  { name: 'lastRebalanced',  type: 'function', stateMutability: 'view', inputs: [],                                     outputs: [{ type: 'uint256' }] },
] as const;

// ─── Utility ──────────────────────────────────────────────────────────────────
function fmtUsdc(raw: bigint | undefined): string {
  if (raw === undefined) return '\u2014';
  return '$' + parseFloat(formatUnits(raw, 6)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(ts: bigint | undefined): string {
  if (!ts || ts === 0n) return '\u2014';
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Stat cell ────────────────────────────────────────────────────────────────
function StatCell({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: '#070707', padding: '20px 24px' }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '0.56rem',
        color: '#555',
        marginBottom: '8px',
        letterSpacing: '1.5px',
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '0.9rem',
        fontWeight: 700,
        color: accent || '#FFFFFF',
        wordBreak: 'break-all',
      }}>
        {value}
      </div>
    </div>
  );
}

// ─── VaultPositionRow ─────────────────────────────────────────────────────────
function VaultPositionRow({
  product,
  userAddress,
  onLoaded,
}: {
  product: any;
  userAddress: string;
  onLoaded: (hasBal: boolean) => void;
}) {
  const VAULT_ADDRESS = product.contract_address as `0x${string}` | undefined;
  const chain: string | undefined = product.blueprint_json?.chain;

  const { data: userShares } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress as `0x${string}`] : undefined,
    query: { enabled: !!VAULT_ADDRESS && !!userAddress },
  });

  const { data: userAssets } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'convertToAssets',
    args: userShares !== undefined ? [userShares as bigint] : undefined,
    query: { enabled: !!VAULT_ADDRESS && !!userAddress && userShares !== undefined },
  });

  const { data: totalAssets } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'totalAssets',
    query: { enabled: !!VAULT_ADDRESS && !!userAddress },
  });

  const { data: strategyName } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'strategyName',
    query: { enabled: !!VAULT_ADDRESS && !!userAddress },
  });

  const { data: lastRebalanced } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'lastRebalanced',
    query: { enabled: !!VAULT_ADDRESS && !!userAddress },
  });

  const hasPosition = userShares !== undefined && (userShares as bigint) > 0n;

  // FIX: always call onLoaded once userShares resolves (even if 0), using a ref to prevent duplicates
  const reported = React.useRef(false);
  useEffect(() => {
    if (userShares !== undefined && VAULT_ADDRESS && !reported.current) {
      reported.current = true;
      onLoaded(hasPosition);
    }
  }, [userShares, VAULT_ADDRESS, hasPosition, onLoaded]);

  if (!hasPosition) return null;

  const explorerUrl = getExplorerUrl(chain, 'address', VAULT_ADDRESS as string);
  const sName = (strategyName as string | undefined) || product.blueprint_json?.strategy_name || 'HSWARM VAULT';
  const displayChain = chain?.toUpperCase() || 'ARBITRUM SEPOLIA';

  return (
    <div style={{ border: '1px solid #2A2A2A', background: '#060606', marginBottom: '24px' }}>
      <div style={{
        padding: '24px',
        borderBottom: '1px solid #1A1A1A',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: '#00FF66',
            marginTop: '6px',
            flexShrink: 0,
            animation: 'dot-pulse-green 2s ease-in-out infinite',
          }} />
          <div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.58rem',
              color: '#FF2A2A',
              letterSpacing: '2px',
              marginBottom: '4px',
            }}>
              ERC-4626 VAULT &middot; {displayChain}
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.1rem',
              fontWeight: 900,
              color: '#FFFFFF',
              textTransform: 'uppercase',
            }}>
              {sName}
            </div>
            {VAULT_ADDRESS && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.58rem',
                  color: '#444',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginTop: '6px',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#888')}
                onMouseLeave={e => (e.currentTarget.style.color = '#444')}
              >
                {VAULT_ADDRESS.substring(0, 10)}&hellip;{VAULT_ADDRESS.substring(38)}
                <ExternalLink size={10} />
              </a>
            )}
          </div>
        </div>

        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.58rem',
          padding: '5px 12px',
          background: 'rgba(0,255,102,0.08)',
          border: '1px solid #00FF66',
          color: '#00FF66',
          animation: 'pulse-green 2.5s ease-in-out infinite',
          whiteSpace: 'nowrap',
        }}>
          &#9679; ACTIVE
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: '#1A1A1A' }}>
        <StatCell label="YOUR POSITION (USDC)" value={fmtUsdc(userAssets as bigint | undefined)} accent="#00FF66" />
        <StatCell label="VAULT TVL (USDC)"     value={fmtUsdc(totalAssets as bigint | undefined)} />
        <StatCell label="STRATEGY"             value={typeof strategyName === 'string' ? strategyName : '\u2014'} />
        <StatCell label="LAST REBALANCED"      value={fmtDate(lastRebalanced as bigint | undefined)} />
      </div>

      <div style={{ padding: '16px 24px', display: 'flex', gap: '12px' }}>
        <Link to={`/product/${product.product_id}`} style={{ textDecoration: 'none', flex: 1 }}>
          <button style={{
            width: '100%',
            background: '#FF2A2A',
            color: '#FFFFFF',
            border: 'none',
            padding: '12px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.72rem',
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '2px',
          }}>
            [ MANAGE POSITION ]
          </button>
        </Link>
        <Link to={`/product/${product.product_id}`} style={{ textDecoration: 'none', flex: 1 }}>
          <button
            style={{
              width: '100%',
              background: 'transparent',
              color: '#FFFFFF',
              border: '1px solid #2A2A2A',
              padding: '12px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.72rem',
              cursor: 'pointer',
              letterSpacing: '2px',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#FFFFFF')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#2A2A2A')}
          >
            [ WITHDRAW ]
          </button>
        </Link>
      </div>
    </div>
  );
}

// ─── VisualProductRow ─────────────────────────────────────────────────────────
function VisualProductRow({ product }: { product: any }) {
  const pName = product.blueprint_json?.strategy_name || 'HSWARM VISUAL DASHBOARD';
  const protocol = product.blueprint_json?.consensus_decision?.target_protocol || 'UNKNOWN';

  return (
    <div style={{ border: '1px solid #2A2A2A', background: '#060606', marginBottom: '24px' }}>
      <div style={{
        padding: '24px',
        borderBottom: '1px solid #1A1A1A',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: '#B64FC8',
            marginTop: '6px',
            flexShrink: 0,
            animation: 'dot-pulse-purple 2s ease-in-out infinite',
          }} />
          <div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.58rem',
              color: '#B64FC8',
              letterSpacing: '2px',
              marginBottom: '4px',
            }}>
              ANALYTICS DASHBOARD
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '1.1rem',
              fontWeight: 900,
              color: '#FFFFFF',
              textTransform: 'uppercase',
            }}>
              {pName}
            </div>
          </div>
        </div>

        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.58rem',
          padding: '5px 12px',
          background: 'rgba(182,79,200,0.08)',
          border: '1px solid #B64FC8',
          color: '#B64FC8',
          whiteSpace: 'nowrap',
        }}>
          &#9679; SUBSCRIBED
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: '#1A1A1A' }}>
        <StatCell label="SUBSCRIPTION"    value="FREE TIER" />
        <StatCell label="TYPE"            value="VISUAL PRODUCT" />
        <StatCell label="TARGET PROTOCOL" value={protocol} />
      </div>

      <div style={{ padding: '16px 24px', display: 'flex', gap: '12px' }}>
        <Link to={`/product/${product.product_id}`} style={{ textDecoration: 'none', flex: 1 }}>
          <button style={{
            width: '100%',
            background: '#B64FC8',
            color: '#FFFFFF',
            border: 'none',
            padding: '12px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.72rem',
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '2px',
          }}>
            [ OPEN DASHBOARD ]
          </button>
        </Link>
      </div>
    </div>
  );
}

// ─── UsingPage ────────────────────────────────────────────────────────────────
export default function UsingPage() {
  const { address, isConnected } = useAccount();

  const [vaultProducts, setVaultProducts]       = useState<any[]>([]);
  const [inscribedVisuals, setInscribedVisuals] = useState<any[]>([]);
  const [activeCount, setActiveCount]           = useState<number>(0);
  const [loadedCount, setLoadedCount]           = useState<number>(0);

  useEffect(() => {
    const inscribedIds: string[] = JSON.parse(localStorage.getItem('hswarm_inscribed') || '[]');

    fetch(`${API}/api/products`)
      .then(r => r.json())
      .then(d => {
        if (d.products) {
          setVaultProducts(
            d.products.filter((p: any) => p.contract_address && p.purpose === 'VAULT')
          );
          setInscribedVisuals(
            d.products.filter((p: any) => p.purpose === 'VISUAL' && inscribedIds.includes(p.product_id))
          );
        }
      })
      .catch(console.error);
  }, []);

  // FIX: every VaultPositionRow calls this once when userShares resolves, even if 0
  const handlePositionLoaded = useCallback((hasBal: boolean) => {
    if (hasBal) setActiveCount(prev => prev + 1);
    setLoadedCount(prev => prev + 1);
  }, []);

  if (!isConnected) {
    return (
      <div style={{
        background: '#000000',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '24px',
      }}>
        <pre style={{
          fontFamily: "'JetBrains Mono', monospace",
          color: '#2A2A2A',
          fontSize: '0.8rem',
          textAlign: 'center',
          lineHeight: 1.6,
        }}>{`  .-------------------------------.\n  |  [!] WALLET NOT CONNECTED    |\n  |  Connect your wallet to see  |\n  |  your active interactions.   |\n  '-------------------------------'`}</pre>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.75rem',
          color: '#444',
          letterSpacing: '2px',
        }}>
          CONNECT WALLET TO VIEW YOUR INTERACTIONS
        </div>
      </div>
    );
  }

  const fullyLoaded  = vaultProducts.length === 0 || loadedCount >= vaultProducts.length;
  const hasAnyActive = activeCount > 0 || inscribedVisuals.length > 0;

  const summaryParts: string[] = [];
  if (activeCount > 0)             summaryParts.push(`${activeCount} VAULT${activeCount !== 1 ? 'S' : ''} ACTIVE`);
  if (inscribedVisuals.length > 0) summaryParts.push(`${inscribedVisuals.length} SUBSCRIBED`);
  const summaryLine = fullyLoaded && summaryParts.length > 0 ? summaryParts.join(' \u00b7 ') : null;

  const walletChain      = vaultProducts[0]?.blueprint_json?.chain;
  const walletExplorerUrl = getExplorerUrl(walletChain, 'address', address as string);

  return (
    <div style={{ background: '#000000', minHeight: '100vh' }}>
      <style>{KEYFRAMES}</style>

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div style={{ padding: '48px 64px', borderBottom: '1px solid #2A2A2A' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '20px', flexWrap: 'wrap', marginBottom: '4px' }}>
          <h1 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '1.8rem',
            fontWeight: 900,
            color: '#FFFFFF',
            letterSpacing: '2px',
            textTransform: 'uppercase',
            margin: 0,
          }}>
            USING
          </h1>
          {summaryLine && (
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.62rem',
              color: '#FF2A2A',
              letterSpacing: '2px',
              fontWeight: 700,
              background: 'rgba(255,42,42,0.08)',
              border: '1px solid #2A2A2A',
              padding: '4px 10px',
            }}>
              {summaryLine}
            </span>
          )}
        </div>
        <p style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.82rem',
          color: '#555',
          margin: 0,
        }}>
          Your interactions with HSwarm agentic products.
        </p>
      </div>

      {/* ── Wallet bar ────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 64px', borderBottom: '1px solid #1A1A1A', background: '#040404' }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.55rem',
          color: '#444',
          letterSpacing: '2px',
          marginBottom: '4px',
        }}>
          CONNECTED WALLET
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.82rem',
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          {address}
          <a
            href={walletExplorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#444', display: 'inline-flex', alignItems: 'center' }}
            onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#888')}
            onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#444')}
          >
            <ExternalLink size={12} />
          </a>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div style={{ padding: '48px 64px' }}>
        {/* Visual products render immediately — no blockchain reads needed */}
        {inscribedVisuals.map(p => (
          <VisualProductRow key={p.product_id} product={p} />
        ))}

        {/* Vault rows — each calls onLoaded once userShares resolves */}
        {vaultProducts.map(p => (
          <VaultPositionRow
            key={p.product_id}
            product={p}
            userAddress={address as string}
            onLoaded={handlePositionLoaded}
          />
        ))}

        {/* Loading state */}
        {!fullyLoaded && vaultProducts.length > 0 && (
          <div style={{
            textAlign: 'center',
            color: '#555',
            padding: '48px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.75rem',
            letterSpacing: '2px',
          }}>
            SCANNING POSITIONS&hellip;
          </div>
        )}

        {/* Empty state */}
        {fullyLoaded && !hasAnyActive && (
          <div style={{ textAlign: 'center', padding: '80px 40px' }}>
            <pre style={{
              fontFamily: "'JetBrains Mono', monospace",
              color: '#2A2A2A',
              marginBottom: '24px',
              fontSize: '0.78rem',
              lineHeight: 1.6,
            }}>{`  .--------------------------------------------.\n  |  [NO ACTIVE POSITIONS]                     |\n  |  You have not invested in any vault yet.   |\n  |  Go to PRODUCTS to deposit USDC.           |\n  '--------------------------------------------'`}</pre>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.75rem',
              color: '#444',
              marginBottom: '32px',
              letterSpacing: '2px',
            }}>
              YOU HAVE NO ACTIVE POSITIONS OR SUBSCRIPTIONS
            </div>
            <Link to="/products">
              <button style={{
                background: '#FF2A2A',
                color: '#FFFFFF',
                border: 'none',
                padding: '14px 36px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                letterSpacing: '2px',
              }}>
                [ BROWSE PRODUCTS ]
              </button>
            </Link>
          </div>
        )}

        {/* No products at all from API */}
        {vaultProducts.length === 0 && inscribedVisuals.length === 0 && fullyLoaded && (
          <div style={{
            textAlign: 'center',
            color: '#444',
            padding: '40px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.75rem',
            letterSpacing: '2px',
          }}>
            NO LIVE PRODUCTS AVAILABLE YET
          </div>
        )}
      </div>
    </div>
  );
}
