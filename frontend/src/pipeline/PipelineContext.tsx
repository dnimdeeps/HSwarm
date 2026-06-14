import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

const API = '';

type PipelineStatus = 'IDLE' | 'RUNNING' | 'WAITING_AGENTS' | 'COMPLETE' | 'ERROR';

interface PipelineState {
  status: PipelineStatus;
  logs: { text: string; color: string }[];
  formationId?: string;
  productId?: string;
}

interface PipelineContextValue {
  pipeline: PipelineState;
  startPipeline: (params: { network: string; purpose: string; numAgents: number }) => void;
  startPublicFormation: (params: { network: string; purpose: string; numAgents: number; requireFree: boolean }) => Promise<string | undefined>;
  addLog: (text: string, color?: string) => void;
  setStatus: (status: PipelineStatus) => void;
  reset: () => void;
}

const PipelineContext = createContext<PipelineContextValue | null>(null);

function colorForLog(text: string): string {
  if (text.includes('=== STEP')) return '#00CCFF';
  if (text.includes('✓')) return '#00FF66';
  if (text.includes('[ERR')) return '#FF2A2A';
  if (text.includes('Failed')) return '#FF2A2A';
  return '#888';
}

export function PipelineProvider({ children }: { children: React.ReactNode }) {
  const [pipeline, setPipeline] = useState<PipelineState>({ status: 'IDLE', logs: [] });
  const esRef = useRef<EventSource | null>(null);

  const addLog = useCallback((text: string, color = '#888') => {
    const ts = new Date().toLocaleTimeString();
    setPipeline(prev => ({ ...prev, logs: [...prev.logs, { text: `[${ts}] ${text}`, color }] }));
  }, []);

  const setStatus = useCallback((status: PipelineStatus) => {
    setPipeline(prev => ({ ...prev, status }));
  }, []);

  const reset = useCallback(() => {
    setPipeline({ status: 'IDLE', logs: [] });
  }, []);

  // Connect to SSE stream and restore past state on mount
  useEffect(() => {
    // Restore any existing pipeline state
    fetch(`${API}/api/pipeline/status`)
      .then(r => r.json())
      .then(d => {
        if (d.logs && d.logs.length > 0) {
          const formatted = d.logs.map((data: any) => {
            const c = colorForLog(data.log);
            return { text: `[RESTORED] ${data.log}`, color: c };
          });
          setPipeline(prev => ({ ...prev, logs: [...prev.logs, ...formatted] }));
          if (d.isRunning) setPipeline(prev => ({ ...prev, status: 'RUNNING' }));
          else if (d.done) setPipeline(prev => ({ ...prev, status: 'COMPLETE' }));
        }
      })
      .catch(() => {});

    // Connect to SSE stream for live events
    const es = new EventSource(`${API}/api/pipeline/stream`);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.log) {
          addLog(data.log, colorForLog(data.log));
        }
        if (data.done) {
          setStatus('COMPLETE');
        }
      } catch {}
    };

    es.onerror = () => {};

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [addLog, setStatus]);

  const startPipeline = useCallback(async ({ network, purpose, numAgents }: { network: string; purpose: string; numAgents: number }) => {
    setPipeline({ status: 'RUNNING', logs: [] });

    try {
      const r = await fetch(`${API}/api/pipeline/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ network, purpose, numAgents }),
      });
      const d = await r.json();
      if (d.error) {
        addLog(`[ERR] ${d.error}`, '#FF2A2A');
        setStatus('ERROR');
      }
    } catch (e: any) {
      addLog(`[ERR] Failed to start pipeline: ${e.message}`, '#FF2A2A');
      setStatus('ERROR');
    }
  }, [addLog, setStatus]);

  const startPublicFormation = useCallback(async ({ network, purpose, numAgents, requireFree }: { network: string; purpose: string; numAgents: number; requireFree: boolean }) => {
    try {
      const r = await fetch(`${API}/api/formations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose, network, num_agents: numAgents, require_free: requireFree }),
      });
      const d = await r.json();
      if (d.error) {
        addLog(`[ERR] Failed to create formation: ${d.error}`, '#FF2A2A');
        setStatus('ERROR');
        return undefined;
      }
      setPipeline(prev => ({ ...prev, formationId: d.id }));
      setStatus('WAITING_AGENTS');
      addLog(`✓ Formation created. ID: ${d.id}`, '#00FF66');
      addLog('Visible in JOIN tab. Waiting for ERC-8004 agents to enroll.', '#FFFFFF');
      addLog('Steps 2-5 will run automatically once agents have joined.', '#888');
      return d.id;
    } catch (e: any) {
      addLog(`[ERR] Failed to create formation: ${e.message}`, '#FF2A2A');
      setStatus('ERROR');
      return undefined;
    }
  }, [addLog, setStatus]);

  return (
    <PipelineContext.Provider value={{ pipeline, startPipeline, startPublicFormation, addLog, setStatus, reset }}>
      {children}
    </PipelineContext.Provider>
  );
}

export function usePipeline() {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error('usePipeline must be used within PipelineProvider');
  return ctx;
}
