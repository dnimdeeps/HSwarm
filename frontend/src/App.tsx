import React from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { PipelineProvider, usePipeline } from './pipeline/PipelineContext';
import LandingPage from './pages/LandingPage';
import CreateOrJoin from './pages/CreateOrJoin';
import AgenticProducts from './pages/AgenticProducts';
import ProductDetail from './pages/ProductDetail';
import UsingPage from './pages/UsingPage';

function Navbar() {
  const location = useLocation();
  const { pipeline } = usePipeline();
  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  const statusColor = { IDLE: '#333', RUNNING: '#00CCFF', WAITING_AGENTS: '#FFCC00', COMPLETE: '#00FF66', ERROR: '#FF2A2A' }[pipeline.status];

  return (
    <nav style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '0 32px',
      height: '56px',
      borderBottom: '1px solid #2A2A2A',
      background: '#000000',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      <Link to="/" style={{ textDecoration: 'none' }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 900,
          fontSize: '1.1rem',
          letterSpacing: '6px',
          color: '#FFFFFF',
          textTransform: 'uppercase',
        }}>
          H<span style={{ color: '#FF2A2A' }}>SWARM</span>
        </span>
      </Link>

      <div style={{ display: 'flex', gap: '0', alignItems: 'center' }}>
        {[
          { to: '/create', label: 'CREATE OR JOIN' },
          { to: '/products', label: 'PRODUCTS' },
          { to: '/using', label: 'USING' },
        ].map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            style={{
              textDecoration: 'none',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.72rem',
              letterSpacing: '2px',
              padding: '0 20px',
              height: '56px',
              display: 'flex',
              alignItems: 'center',
              color: isActive(to) ? '#FFFFFF' : '#666666',
              borderBottom: isActive(to) ? '2px solid #FF2A2A' : '2px solid transparent',
              borderLeft: '1px solid #2A2A2A',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => { if (!isActive(to)) (e.currentTarget as HTMLElement).style.color = '#AAAAAA'; }}
            onMouseLeave={e => { if (!isActive(to)) (e.currentTarget as HTMLElement).style.color = '#666666'; }}
          >
            {label}
          </Link>
        ))}
        {pipeline.status !== 'IDLE' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 16px', borderLeft: '1px solid #2A2A2A' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColor, boxShadow: `0 0 8px ${statusColor}` }} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: statusColor, letterSpacing: '1px' }}>
              {pipeline.status}
            </span>
          </div>
        )}
        <div style={{ borderLeft: '1px solid #2A2A2A', padding: '0 0 0 24px' }}>
          <ConnectButton />
        </div>
      </div>
    </nav>
  );
}

function App() {
  return (
    <BrowserRouter>
      <PipelineProvider>
        <div style={{ minHeight: '100vh', background: '#000000' }}>
          <Navbar />
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/create" element={<CreateOrJoin />} />
            <Route path="/products" element={<AgenticProducts />} />
            <Route path="/product/:id" element={<ProductDetail />} />
            <Route path="/using" element={<UsingPage />} />
          </Routes>
        </div>
      </PipelineProvider>
    </BrowserRouter>
  );
}

export default App;
