import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { usePipeline } from '../pipeline/PipelineContext';

const API = import.meta.env.VITE_API_URL || '';

const PURPOSES = [
  { id: 'VAULT', label: 'DeFi Vault (Yield)', desc: 'AI agents collectively manage capital allocation across DeFi protocols (Aave, Morpho, etc.) to optimize yield.' },
  { id: 'VISUAL', label: 'Visual Analytics', desc: 'Agents aggregate market data and generate an interactive analytics dashboard with charts and consensus signals.' },
  { id: 'ARBITRAGE', label: 'Arbitrage Engine', desc: 'Agents detect and signal cross-protocol price discrepancies for automated execution.', badge: 'COMING SOON' },
  { id: 'SUPERAGENT', label: 'Super Agent (Service)', desc: 'A single unified ERC-8004 agent synthesized from swarm consensus, deployable as a service.', badge: 'COMING SOON' },
];

const NETWORKS = ['Ethereum Mainnet', 'Base Mainnet', 'Arbitrum Sepolia', 'Arbitrum One', 'BNB Chain'];



// ─── JOIN TAB ────────────────────────────────────────────────────────────────

function JoinTab() {
  const [formations, setFormations] = useState<any[]>([]);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState('');
  const [agentName, setAgentName] = useState('');
  const [agentEndpoint, setAgentEndpoint] = useState('');
  const [enrollError, setEnrollError] = useState('');
  const [enrolledMsg, setEnrolledMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const r = await fetch(`${API}/api/formations`);
      const d = await r.json();
      setFormations(d.formations || []);
    } catch { }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleEnroll = async (formationId: string) => {
    setEnrollError('');
    setEnrolledMsg('');
    if (!agentId.trim() || !agentEndpoint.trim()) {
      setEnrollError('Agent ID and MCP endpoint are required.');
      return;
    }
    try {
      const r = await fetch(`${API}/api/formations/${formationId}/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId.trim(), agent_name: agentName.trim() || agentId.trim(), endpoint: agentEndpoint.trim() }),
      });
      const d = await r.json();
      if (d.error) { setEnrollError(d.error); return; }
      setEnrolledMsg('Agent enrolled successfully!');
      setAgentId(''); setAgentName(''); setAgentEndpoint('');
      refresh();
      setTimeout(() => { setEnrollingId(null); setEnrolledMsg(''); }, 2500);
    } catch (e: any) {
      setEnrollError(e.message || 'Failed to enroll');
    }
  };

  const openFormations = formations.filter((f: any) => (f.enrolled_agents || []).length < f.num_agents);
  const fullFormations = formations.filter((f: any) => (f.enrolled_agents || []).length >= f.num_agents);

  if (loading) {
    return <div style={{ padding: '48px 64px', fontFamily: "'JetBrains Mono', monospace", color: '#333' }}>LOADING FORMATIONS...</div>;
  }

  return (
    <div style={{ padding: '48px 64px' }}>
      <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', color: '#555', marginBottom: '36px', maxWidth: '680px', lineHeight: 1.8 }}>
        These formations were initialized with the Public flow and are waiting for ERC-8004 agent owners to connect their agents.
        Once all slots are filled, Steps 2→5 run automatically.
        All agents must communicate via MCP.
      </p>

      {formations.length === 0 ? (
        <div style={{ border: '1px solid #1A1A1A', padding: '64px', textAlign: 'center' }}>
          <pre style={{ fontFamily: "'JetBrains Mono', monospace", color: '#222', marginBottom: '20px', fontSize: '0.78rem' }}>{`  .--------------------------------------------.
  |  [!] NO OPEN FORMATIONS                    |
  |  Create a public formation in the          |
  |  CREATE tab (choose NO to Random Agents).  |
  '--------------------------------------------'`}</pre>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: '#333', letterSpacing: '1px' }}>
            NO PUBLIC FORMATIONS WAITING FOR AGENTS
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {openFormations.length > 0 && (
            <>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', letterSpacing: '3px', color: '#666' }}>
                OPEN — ACCEPTING AGENTS
              </div>
              {openFormations.map((f: any) => (
                <div key={f.id} style={{ border: '1px solid #2A2A2A', background: '#060606' }}>
                  <div style={{ padding: '24px', borderBottom: '1px solid #1A1A1A', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#FF2A2A', letterSpacing: '2px', marginBottom: '4px' }}>PUBLIC FORMATION · {f.network}</div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1rem', fontWeight: 900, color: '#FFFFFF', letterSpacing: '1px' }}>{f.purpose}</div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', color: '#444', marginTop: '4px' }}>ID: {f.id} · Created {new Date(f.created_at).toLocaleDateString()}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#555', marginBottom: '6px', letterSpacing: '1px' }}>SLOTS FILLED</div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.4rem', fontWeight: 900, color: '#FFFFFF' }}>
                        {(f.enrolled_agents || []).length}<span style={{ color: '#555', fontSize: '1rem' }}>/{f.num_agents}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: '16px 24px', borderBottom: '1px solid #1A1A1A' }}>
                    <div style={{ display: 'flex', gap: '3px', marginBottom: '8px' }}>
                      {Array.from({ length: f.num_agents }).map((_, i) => (
                        <div key={i} style={{ flex: 1, height: '6px', background: i < (f.enrolled_agents || []).length ? '#00FF66' : '#1A1A1A' }} />
                      ))}
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#444' }}>
                      {f.num_agents - (f.enrolled_agents || []).length} slots remaining · Free agents only: {f.require_free ? 'YES' : 'NO'}
                    </div>
                  </div>

                  {f.enrolled_agents && f.enrolled_agents.length > 0 && (
                    <div style={{ padding: '16px 24px', borderBottom: '1px solid #1A1A1A' }}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#555', letterSpacing: '1px', marginBottom: '10px' }}>ENROLLED AGENTS</div>
                      {f.enrolled_agents.map((a: any, i: number) => (
                        <div key={i} style={{ display: 'flex', gap: '16px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', color: '#888', padding: '6px 0', borderTop: i > 0 ? '1px solid #111' : 'none' }}>
                          <span style={{ color: '#00FF66' }}>✓</span>
                          <span style={{ color: '#FFFFFF' }}>{a.agent_name}</span>
                          <span style={{ color: '#444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.endpoint}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ padding: '20px 24px' }}>
                    {enrollingId === f.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#666', letterSpacing: '1px', marginBottom: '4px' }}>CONNECT YOUR ERC-8004 AGENT</div>
                        {[
                          { label: 'ERC-8004 AGENT ID *', value: agentId, setter: setAgentId, placeholder: '0x... or agent registry ID' },
                          { label: 'AGENT NAME (optional)', value: agentName, setter: setAgentName, placeholder: 'My DeFi Trading Agent' },
                          { label: 'MCP ENDPOINT *', value: agentEndpoint, setter: setAgentEndpoint, placeholder: 'https://myagent.example.com/mcp' },
                        ].map(({ label, value, setter, placeholder }) => (
                          <div key={label}>
                            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem', color: '#555', letterSpacing: '1px', marginBottom: '5px' }}>{label}</div>
                            <input type="text" value={value} onChange={e => setter(e.target.value)} placeholder={placeholder}
                              style={{ width: '100%', background: '#000', border: '1px solid #2A2A2A', color: '#FFFFFF', padding: '10px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', outline: 'none', boxSizing: 'border-box' }}
                              onFocus={e => (e.target.style.borderColor = '#555')} onBlur={e => (e.target.style.borderColor = '#2A2A2A')} />
                          </div>
                        ))}
                        {enrollError && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', color: '#FF2A2A', padding: '8px', background: 'rgba(255,42,42,0.05)', border: '1px solid #FF2A2A' }}>⚠ {enrollError}</div>}
                        {enrolledMsg && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', color: '#00FF66', padding: '8px', background: 'rgba(0,255,102,0.05)', border: '1px solid #00FF66' }}>✓ {enrolledMsg}</div>}
                        <div style={{ display: 'flex', gap: '12px' }}>
                          <button onClick={() => handleEnroll(f.id)}
                            style={{ flex: 1, background: '#FF2A2A', color: '#FFFFFF', border: 'none', padding: '12px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '1px' }}>
                            [ ENROLL AGENT ]
                          </button>
                          <button onClick={() => { setEnrollingId(null); setEnrollError(''); setAgentId(''); setAgentName(''); setAgentEndpoint(''); }}
                            style={{ background: 'transparent', border: '1px solid #2A2A2A', color: '#888', padding: '12px 16px', cursor: 'pointer' }}>
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => { setEnrollingId(f.id); setEnrollError(''); setEnrolledMsg(''); }}
                        style={{ width: '100%', background: 'transparent', border: '1px solid #2A2A2A', color: '#FFFFFF', padding: '12px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', cursor: 'pointer', letterSpacing: '2px' }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = '#FFFFFF')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = '#2A2A2A')}>
                        [ CONNECT YOUR ERC-8004 AGENT ]
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {fullFormations.length > 0 && (
            <>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', letterSpacing: '3px', color: '#444', marginTop: '16px' }}>
                FULL — PIPELINE RUNNING
              </div>
              {fullFormations.map((f: any) => (
                <div key={f.id} style={{ border: '1px solid #1A1A1A', background: '#040404', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem', fontWeight: 700, color: '#888' }}>{f.purpose} · {f.network}</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#333', marginTop: '4px' }}>ID: {f.id} · {f.num_agents} agents enrolled</div>
                  </div>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#00CCFF', border: '1px solid #00CCFF', padding: '4px 10px', letterSpacing: '1px' }}>
                    PIPELINE RUNNING
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CREATE TAB ───────────────────────────────────────────────────────────────

function CreateTab() {
  const { pipeline, startPipeline, startPublicFormation, addLog, reset } = usePipeline();
  const [useRandom, setUseRandom] = useState<boolean | null>(null);
  const [purpose, setPurpose] = useState('VAULT');
  const [network, setNetwork] = useState('Arbitrum Sepolia');
  const [numAgents, setNumAgents] = useState(10);
  const [requireFree, setRequireFree] = useState(true);
  const [discoveryMode, setDiscoveryMode] = useState('CACHE');
  const [registryData, setRegistryData] = useState<any>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API}/api/registry`).then(r => r.json()).then(setRegistryData).catch(() => {});
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [pipeline.logs]);

  const handleStart = () => {
    if (useRandom === null) return;
    reset();

    if (useRandom) {
      startPipeline({ network, purpose, numAgents });
    } else {
      addLog('Initializing PUBLIC formation...', '#FFFFFF');
      addLog(`Purpose: ${purpose} | Network: ${network} | Slots: ${numAgents}`, '#888');
      addLog('Step 1 SKIPPED - no random agents in public mode.', '#555');
      addLog('Creating public recruitment slot...', '#888');
      setTimeout(() => {
        startPublicFormation({ network, purpose, numAgents, requireFree });
      }, 800);
    }
  };

  const stepsDone = {
    step1: pipeline.status === 'COMPLETE' || (pipeline.status === 'RUNNING' && pipeline.logs.some(l => l.text.includes('STEP 2'))),
    step2: pipeline.status === 'COMPLETE' || (pipeline.status === 'RUNNING' && pipeline.logs.some(l => l.text.includes('STEP 3'))),
    step3: pipeline.status === 'COMPLETE' || (pipeline.status === 'RUNNING' && pipeline.logs.some(l => l.text.includes('STEP 4'))),
    step4: pipeline.status === 'COMPLETE' || (pipeline.status === 'RUNNING' && pipeline.logs.some(l => l.text.includes('STEP 5'))),
    step5: pipeline.status === 'COMPLETE',
  };

  const isRunning = pipeline.status === 'RUNNING';
  const selectedPurpose = PURPOSES.find(p => p.id === purpose);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 'calc(100vh - 168px)' }}>

      {/* LEFT: Config */}
      <div style={{ padding: '48px 64px', borderRight: '1px solid #2A2A2A', overflowY: 'auto' }}>

        {/* Registry summary */}
        {registryData && (
          <div style={{ display: 'flex', gap: '1px', background: '#1A1A1A', marginBottom: '36px' }}>
            {[{ label: 'VALID', v: registryData.valid, c: '#00FF66' }, { label: 'FAILED', v: registryData.failed, c: '#FF2A2A' }, { label: 'TOTAL', v: registryData.total, c: '#FFFFFF' }].map(({ label, v, c }) => (
              <div key={label} style={{ background: '#000', padding: '14px 20px', flex: 1 }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.58rem', color: '#555', marginBottom: '4px', letterSpacing: '1px' }}>{label} AGENTS</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.3rem', fontWeight: 900, color: c }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        {pipeline.status !== 'IDLE' && pipeline.status !== 'RUNNING' ? (
          <div style={{ border: `1px solid ${pipeline.status === 'COMPLETE' ? '#00FF66' : '#00CCFF'}`, padding: '28px', background: pipeline.status === 'COMPLETE' ? 'rgba(0,255,102,0.04)' : 'rgba(0,204,255,0.04)' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.9rem', fontWeight: 700, color: pipeline.status === 'COMPLETE' ? '#00FF66' : '#00CCFF', marginBottom: '12px' }}>
              {pipeline.status === 'COMPLETE' ? '✓ PIPELINE COMPLETE' : '⏳ FORMATION OPEN'}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', color: '#666', lineHeight: 1.8 }}>
              {pipeline.status === 'COMPLETE'
                ? 'Your agentic product has been created. Navigate to the PRODUCTS tab to see it live.'
                : 'Your public formation is live in the JOIN tab. Share it so ERC-8004 agent owners can connect.'}
            </div>
            <button onClick={() => { reset(); setUseRandom(null); }}
              style={{ marginTop: '20px', background: 'transparent', border: '1px solid #2A2A2A', color: '#888', padding: '10px 20px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', cursor: 'pointer', letterSpacing: '1px' }}>
              [ CREATE ANOTHER ]
            </button>
          </div>
        ) : (
          <>
            {/* Use Random Agents */}
            <div style={{ marginBottom: '28px' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#555', letterSpacing: '2px', marginBottom: '14px' }}>USE RANDOM AGENTS?</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: '#2A2A2A' }}>
                {[
                  { val: true, label: 'YES — PRIVATE', desc: 'System auto-selects random agents. Steps 1→5 run automatically.' },
                  { val: false, label: 'NO — PUBLIC', desc: 'Creates an open slot. Users with ERC-8004 agents join manually.' },
                ].map(({ val, label, desc }) => (
                  <div key={label} onClick={() => setUseRandom(val)}
                    style={{ background: useRandom === val ? '#0A0A0A' : '#000', padding: '18px 20px', cursor: 'pointer', borderLeft: useRandom === val ? '3px solid #FF2A2A' : '3px solid transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1rem', color: useRandom === val ? '#FFFFFF' : '#333' }}>{useRandom === val ? '◉' : '○'}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: '0.8rem', color: '#FFFFFF' }}>{label}</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: '#555', margin: 0 }}>{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Purpose */}
            <div style={{ marginBottom: '22px' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#555', letterSpacing: '2px', marginBottom: '12px' }}>PURPOSE</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: '#1A1A1A' }}>
                {PURPOSES.map(p => (
                  <div key={p.id} onClick={() => setPurpose(p.id)} style={{ background: purpose === p.id ? '#0A0A0A' : '#000', padding: '11px 16px', cursor: 'pointer', borderLeft: purpose === p.id ? '3px solid #FF2A2A' : '3px solid transparent' }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', color: purpose === p.id ? '#FFFFFF' : '#555' }}>
                      {purpose === p.id ? '[X]' : '[ ]'} {p.label}
                    </span>
                    {(p as any).badge && (
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', color: '#888', border: '1px solid #888', padding: '2px 6px', marginLeft: '10px', letterSpacing: '1px', verticalAlign: 'middle' }}>
                        {(p as any).badge}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {selectedPurpose && (
                <div style={{ marginTop: '6px', padding: '10px 14px', background: '#040404', border: '1px solid #111', fontSize: '0.75rem', color: '#555', fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6 }}>
                  {selectedPurpose.desc}
                </div>
              )}
            </div>

            {/* Network */}
            <div style={{ marginBottom: '22px' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#555', letterSpacing: '2px', marginBottom: '12px' }}>NETWORK</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {NETWORKS.map(n => (
                  <button key={n} onClick={() => setNetwork(n)}
                    style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', padding: '7px 13px', background: network === n ? '#FFFFFF' : 'transparent', color: network === n ? '#000' : '#555', border: `1px solid ${network === n ? '#FFFFFF' : '#2A2A2A'}`, cursor: 'pointer', letterSpacing: '1px' }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Discovery Mode */}
            <div style={{ marginBottom: '22px' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#555', letterSpacing: '2px', marginBottom: '12px' }}>AGENT DISCOVERY METHOD</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: '#1A1A1A' }}>
                {[
                  { id: 'LIVE', label: 'Live Decentralized Search', desc: 'Real-time IPFS fetching from subgraph. Extremely thorough but slower.' },
                  { id: 'CACHE', label: 'Cache-Based Search', desc: 'Instant SQL search from local database. Fast and reliable.' }
                ].map(d => (
                  <div key={d.id} onClick={() => setDiscoveryMode(d.id)}
                    style={{ background: discoveryMode === d.id ? '#0A0A0A' : '#000', padding: '11px 16px', cursor: 'pointer', borderLeft: discoveryMode === d.id ? '3px solid #FF2A2A' : '3px solid transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1rem', color: discoveryMode === d.id ? '#FFFFFF' : '#333' }}>{discoveryMode === d.id ? '◉' : '○'}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', color: '#FFFFFF' }}>{d.label}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#555', marginLeft: '25px', fontFamily: "'Outfit', sans-serif" }}>{d.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Agents slider */}
            <div style={{ marginBottom: '22px' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: '#555', letterSpacing: '2px', marginBottom: '10px' }}>
                NUMBER OF AGENTS: <span style={{ color: '#FFFFFF' }}>{numAgents}</span>
              </div>
              <input type="range" min={2} max={10} value={numAgents} onChange={e => setNumAgents(Number(e.target.value))} style={{ width: '100%', accentColor: '#FF2A2A' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: '#333', marginTop: '4px' }}>
                <span>2 min</span><span>10 max (current version)</span>
              </div>
            </div>

            {/* Free require */}
            <div style={{ marginBottom: '28px' }}>
              <div onClick={() => setRequireFree(!requireFree)} style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', cursor: 'pointer' }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.1rem', color: requireFree ? '#FFFFFF' : '#333', flexShrink: 0, marginTop: '2px' }}>{requireFree ? '◉' : '○'}</span>
                <div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '4px' }}>REQUIRE FREE AGENTS</div>
                  {!requireFree && (
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', color: '#FF2A2A', lineHeight: 1.6 }}>
                      ⚠ Wallet funds required. Agents using x402 protocol will be used. You will pay for all agents in a single wallet transaction.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* MCP notice */}
            <div style={{ marginBottom: '28px', padding: '12px 16px', background: '#030303', border: '1px solid #1A1A1A', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', color: '#444', lineHeight: 1.7 }}>
              ⚡ All agents communicate via <strong style={{ color: '#888' }}>Model Context Protocol (MCP)</strong>. Agents without an MCP endpoint are not compatible.
            </div>

            <button onClick={handleStart} disabled={useRandom === null || isRunning}
              style={{ width: '100%', background: useRandom === null || isRunning ? '#111' : '#FF2A2A', color: useRandom === null || isRunning ? '#333' : '#FFFFFF', border: 'none', padding: '18px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.82rem', fontWeight: 700, letterSpacing: '2px', cursor: useRandom === null || isRunning ? 'not-allowed' : 'pointer', textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
              {isRunning && <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />}
              {isRunning ? '[ PIPELINE RUNNING... ]' : useRandom === null ? '[ SELECT A FLOW TO CONTINUE ]' : `[ INITIALIZE ${useRandom ? 'PRIVATE' : 'PUBLIC'} FORMATION ]`}
            </button>
          </>
        )}
      </div>

      {/* RIGHT: Console */}
      <div style={{ padding: '48px 64px', background: '#020202', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', letterSpacing: '3px', color: '#555', marginBottom: '20px' }}>
          PIPELINE CONSOLE
        </div>

        <div style={{ background: '#000', border: '1px solid #1A1A1A', padding: '20px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', flex: 1, overflowY: 'auto', maxHeight: '500px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {pipeline.logs.length === 0 ? (
            <div style={{ color: '#222', margin: 'auto 0' }}>Configure and click initialize to start the pipeline.</div>
          ) : (
            pipeline.logs.map((l, i) => <div key={i} style={{ color: l.color }}>{l.text}</div>)
          )}
          <div ref={logEndRef} />
        </div>

        {/* Step pills */}
        {pipeline.status !== 'IDLE' && useRandom === true && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '20px' }}>
            {[
              { label: 'STEP 1: DISCOVERY', done: stepsDone.step1 },
              { label: 'STEP 2: AUDIT', done: stepsDone.step2 },
              { label: 'STEP 3: STANDARDIZE', done: stepsDone.step3 },
              { label: 'STEP 4: CONSENSUS', done: stepsDone.step4 },
              { label: 'STEP 5: DEPLOY', done: stepsDone.step5 },
            ].map(({ label, done }) => (
              <span key={label} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', padding: '5px 10px', background: done ? 'rgba(0,255,102,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${done ? '#00FF66' : '#1A1A1A'}`, color: done ? '#00FF66' : '#333', letterSpacing: '1px' }}>
                {done ? '✓' : '○'} {label}
              </span>
            ))}
          </div>
        )}

        {pipeline.status === 'WAITING_AGENTS' && (
          <div style={{ marginTop: '20px', padding: '16px', background: 'rgba(0,204,255,0.04)', border: '1px solid #00CCFF', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: '#00CCFF' }}>
            ⏳ Public formation active. Go to the JOIN tab to see it and share the link.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PAGE SHELL ───────────────────────────────────────────────────────────────

export default function CreateOrJoin() {
  const [tab, setTab] = useState<'CREATE' | 'JOIN'>('CREATE');

  return (
    <div style={{ background: '#000000', minHeight: '100vh' }}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      <div style={{ padding: '48px 64px 0', borderBottom: '1px solid #2A2A2A' }}>
        <h1 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '1.8rem', fontWeight: 900, color: '#FFFFFF', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>
          CREATE OR JOIN
        </h1>
        <p style={{ fontSize: '0.82rem', color: '#555', fontFamily: "'JetBrains Mono', monospace", marginBottom: '32px' }}>
          Initialize a new agentic product or connect your ERC-8004 agent to an open public formation.
        </p>
        <div style={{ display: 'flex', borderBottom: '1px solid #2A2A2A' }}>
          {(['CREATE', 'JOIN'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ background: 'transparent', border: 'none', borderBottom: tab === t ? '2px solid #FF2A2A' : '2px solid transparent', color: tab === t ? '#FFFFFF' : '#555', padding: '14px 32px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', letterSpacing: '2px', cursor: 'pointer' }}>
              [{tab === t ? 'X' : ' '}] {t}
            </button>
          ))}
        </div>
      </div>

      {tab === 'CREATE' ? <CreateTab /> : <JoinTab />}
    </div>
  );
}
