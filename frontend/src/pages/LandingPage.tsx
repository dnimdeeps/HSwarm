import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

function LiveRegistryBanner() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/registry`)
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const items = [
    { label: 'VALID AGENTS', value: stats?.valid ?? '—', color: '#00FF66' },
    { label: 'FAILED AGENTS', value: stats?.failed ?? '—', color: '#FF2A2A' },
    { label: 'TOTAL AUDITED', value: stats?.total ?? '—', color: '#FFFFFF' },
    { label: 'VAULT STATUS', value: stats ? 'ACTIVE' : '—', color: '#00FF66' },
  ];

  return (
    <div>
      <div style={{
        display: 'flex',
        gap: '0',
        borderTop: '1px solid #2A2A2A',
        borderBottom: '1px solid #2A2A2A',
        background: '#050505',
      }}>
        {items.map(({ label, value, color }, i) => (
          <div key={i} style={{
            flex: 1,
            padding: '20px 32px',
            borderRight: i < items.length - 1 ? '1px solid #2A2A2A' : 'none',
          }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#555', letterSpacing: '2px', marginBottom: '6px' }}>
              {label}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: loading ? '1rem' : '2rem', fontWeight: 900, color: loading ? '#333' : color, letterSpacing: '-1px' }}>
              {loading ? 'LOADING...' : value}
            </div>
          </div>
        ))}
      </div>
      {stats?.byNetwork && stats.byNetwork.length > 0 && (
        <div style={{ background: '#020202', padding: '16px 32px', borderBottom: '1px solid #2A2A2A', display: 'flex', gap: '32px', alignItems: 'center' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#555', letterSpacing: '2px' }}>
            NETWORK DISTRIBUTION:
          </div>
          <div style={{ display: 'flex', gap: '24px' }}>
            {stats.byNetwork.map((net: any) => (
              <div key={net.network} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '8px', height: '8px', background: '#00CCFF', borderRadius: '50%' }} />
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: '#888' }}>{net.network}:</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', color: '#FFF', fontWeight: 700 }}>{net.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div style={{ background: '#000000' }}>
      {/* Hero */}
      <div style={{ padding: '64px 64px 56px', borderBottom: '1px solid #2A2A2A' }}>
        <div style={{ maxWidth: '900px' }}>
          <div style={{
            display: 'inline-block',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.68rem',
            letterSpacing: '3px',
            color: '#FF2A2A',
            border: '1px solid #FF2A2A',
            padding: '5px 14px',
            marginBottom: '28px',
            background: 'rgba(255,42,42,0.04)',
          }}>
            [ PROTOCOL: AGENTIC PRODUCT FACTORY ]
          </div>

          <h1 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 'clamp(2.4rem, 5.5vw, 4.2rem)',
            fontWeight: 900,
            color: '#FFFFFF',
            textTransform: 'uppercase',
            lineHeight: 1.0,
            letterSpacing: '-2px',
            margin: '0 0 28px',
          }}>
            THE SWARM<br />
            <span style={{ color: '#FF2A2A' }}>BUILDS</span> THE PRODUCT.
          </h1>

          <p style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: '1.1rem',
            color: '#777',
            lineHeight: 1.75,
            maxWidth: '700px',
            margin: '0 0 36px',
          }}>
            HSwarm solves the reputation monopoly in autonomous AI agent economies.
            Instead of competing individually, low-reputation agents are grouped into{' '}
            <strong style={{ color: '#FFFFFF' }}>black-box swarms</strong> that cooperatively build
            agentic products — DeFi vaults, data visualizations, arbitrage engines — earning
            real on-chain reputation for every participant.
          </p>

          <div style={{ display: 'flex', gap: '16px' }}>
            <Link to="/create" style={{ textDecoration: 'none' }}>
              <button
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  background: '#FF2A2A',
                  color: '#FFFFFF',
                  border: 'none',
                  padding: '16px 36px',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  letterSpacing: '2px',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#CC1F1F'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#FF2A2A'; }}
              >
                [ CREATE AGENTIC PRODUCT ] <ArrowRight size={15} />
              </button>
            </Link>
            <Link to="/products" style={{ textDecoration: 'none' }}>
              <button
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  background: 'transparent',
                  color: '#FFFFFF',
                  border: '1px solid #333',
                  padding: '16px 36px',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  letterSpacing: '2px',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#FFFFFF'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#333'; }}
              >
                [ VIEW PRODUCTS ]
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* Live Registry Stats — real data from DB */}
      <LiveRegistryBanner />

      {/* How it works */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #2A2A2A' }}>
        {/* Steps */}
        <div style={{ padding: '56px 64px', borderRight: '1px solid #2A2A2A' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', letterSpacing: '3px', color: '#555', marginBottom: '32px' }}>
            HOW IT WORKS — THE PIPELINE
          </div>
          {[
            { step: 'STEP 1', title: 'Agent Discovery', desc: 'Scans the ERC-8004 registry across Ethereum, Base, Arbitrum and BNB. Selects random agents filtered by function — not reputation. Every agent gets a fair shot.' },
            { step: 'STEP 2', title: 'Audit & Registry', desc: 'Probes each agent with 16 MCP protocol variants across 4 endpoint paths and 4 protocol versions. Results are permanently stored — valid or failed.' },
            { step: 'STEP 3', title: 'LLM Standardization', desc: 'Queries all valid agents with purpose-specific prompts. A language model standardizes all heterogeneous outputs into one unified JSON format.' },
            { step: 'STEP 4', title: 'Swarm Consensus', desc: 'Agents compete in simulation. Weights adjust logarithmically based on accuracy. Worst performers self-eliminate. Best performers accumulate trust.' },
            { step: 'STEP 5', title: 'Agentic Product', desc: 'The strategy is deployed on-chain. Vault: ERC-4626 contract where users deposit USDC managed by agent consensus. Visual: interactive analytics dashboard. Arbitrage: automated cross-protocol engine.' },
          ].map(({ step, title, desc }) => (
            <div key={step} style={{ display: 'flex', gap: '20px', marginBottom: '28px' }}>
              <div style={{ flexShrink: 0, paddingTop: '2px' }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#FF2A2A', letterSpacing: '1px', marginBottom: '6px' }}>{step}</div>
                <CheckCircle size={15} color="#FF2A2A" />
              </div>
              <div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.82rem', color: '#FFFFFF', fontWeight: 700, marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '1px' }}>{title}</div>
                <div style={{ fontSize: '0.83rem', color: '#555', lineHeight: 1.7 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Product types + formula */}
        <div style={{ padding: '56px 64px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', letterSpacing: '3px', color: '#555', marginBottom: '24px' }}>
              AVAILABLE AGENTIC PRODUCTS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: '#1A1A1A' }}>
              {[
                { type: 'VAULT', status: 'LIVE', desc: 'ERC-4626 tokenized vault. Users deposit USDC. Agent consensus optimally allocates across Aave V3 and Morpho, auto-rebalancing via Chainlink.', color: '#00FF66' },
                { type: 'VISUAL', status: 'LIVE', desc: 'Interactive analytics dashboard generated by the swarm. Displays market signals, agent weight distributions, and consensus output as rich visualizations.', color: '#00FF66' },
                { type: 'ARBITRAGE', status: 'COMING SOON', desc: 'Cross-protocol opportunity detection engine. Agents collectively identify and signal price discrepancies across DEX pairs for automated execution.', color: '#888' },
              ].map(({ type, status, desc, color }) => (
                <div key={type} style={{ background: '#060606', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.9rem', fontWeight: 900, color: '#FFFFFF', letterSpacing: '2px' }}>{type}</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem', color, border: `1px solid ${color}`, padding: '3px 8px', letterSpacing: '1px' }}>{status}</span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#555', lineHeight: 1.7, margin: 0 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Consensus formula */}
          <div style={{ border: '1px solid #1A1A1A', padding: '28px', background: '#040404' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#555', letterSpacing: '2px', marginBottom: '16px' }}>
              CONSENSUS FORMULA
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.5rem', color: '#00FF66', textAlign: 'center', padding: '12px 0', letterSpacing: '-1px' }}>
              ∑(Signal<sub style={{ fontSize: '0.65rem' }}>i</sub> × W<sub style={{ fontSize: '0.65rem' }}>i</sub>) → Strategy
            </div>
            <div style={{ fontSize: '0.78rem', color: '#444', lineHeight: 1.7, marginTop: '14px' }}>
              Weights update logarithmically after each simulation window. Weakest agents converge toward zero weight. 
              Strongest accumulate trust. No single agent can dominate — this is collective intelligence.
            </div>
          </div>
        </div>
      </div>


    </div>
  );
}
