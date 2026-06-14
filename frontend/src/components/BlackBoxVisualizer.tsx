import React from 'react';

export default function BlackBoxVisualizer({ agentsCount, maxAgents, triggeringAnimation }: { agentsCount: number, maxAgents: number, triggeringAnimation: boolean }) {
  
  const renderSlots = () => {
    const slots = [];
    for (let i = 0; i < maxAgents; i++) {
      const isOccupied = i < agentsCount;
      const isJustAdded = triggeringAnimation && i === agentsCount - 1;

      slots.push(
        <div key={i} style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
          
          {/* PCB Routing Line Animation */}
          {isJustAdded && (
            <div style={{
              position: 'absolute',
              right: '100%',
              top: '50%',
              height: '1px',
              background: '#FFFFFF',
              width: '150px',
              transformOrigin: 'right',
              animation: 'slide-in-right 0.3s ease-out forwards'
            }} />
          )}

          <div 
            className={`font-mono ${isJustAdded ? '' : ''}`}
            style={{
              width: '60px',
              height: '60px',
              background: isOccupied ? '#FFFFFF' : 'transparent',
              border: isOccupied ? 'none' : '1px dashed #2A2A2A',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              color: '#000000',
              fontWeight: 700,
              fontSize: '0.9rem',
              zIndex: 10
            }}
          >
            {isOccupied ? `#${(1000 + i)}` : ''}
          </div>
        </div>
      );
    }
    return slots;
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      
      {/* Capacity Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '40px' }}>
        <span className="font-mono text-muted" style={{ fontSize: '0.9rem', letterSpacing: '1px' }}>
          CAPACITY: [{agentsCount}/{maxAgents}]
        </span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {Array.from({ length: maxAgents }).map((_, i) => (
            <div key={i} style={{
              width: '24px',
              height: '8px',
              background: i < agentsCount ? '#FFFFFF' : '#2A2A2A'
            }} />
          ))}
        </div>
      </div>

      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        width: '100%',
        maxWidth: '900px',
        position: 'relative'
      }}>
        
        {/* Left Inputs (Slots) */}
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '8px', 
          alignItems: 'flex-end', 
          paddingRight: '32px'
        }}>
          {renderSlots()}
        </div>

        {/* Central Black Box Monolith */}
        <div style={{
          width: '250px',
          height: `${Math.max(300, maxAgents * 68)}px`,
          background: '#050505',
          border: '1px solid #2A2A2A',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 10
        }}>
          <h2 className=" font-mono" style={{ letterSpacing: '8px', color: '#fff', opacity: 0.8 }}>MIXER</h2>
        </div>

        {/* Right Output (Vault) */}
        <div style={{ display: 'flex', paddingLeft: '32px', alignItems: 'center' }}>
           <div 
            style={{
              width: '120px',
              height: '80px',
              background: '#FFFFFF',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              clipPath: 'polygon(0% 0%, 80% 0%, 100% 50%, 80% 100%, 0% 100%)'
            }}
          >
            <span className="font-mono" style={{ fontSize: '0.9rem', fontWeight: 700, color: '#000', paddingRight: '15px' }}>ERC-4626</span>
          </div>
        </div>

      </div>

    </div>
  );
}
