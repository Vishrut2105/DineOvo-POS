import React, { useState } from 'react';
import CatcherGame from './CatcherGame';
import MemoryGame from './MemoryGame';
import CoffeeStacker from './CoffeeStacker';

export default function ArcadeTab() {
  const [activeGame, setActiveGame] = useState('catcher');

  const games = [
    { id: 'catcher', label: 'Flavour Catcher' },
    { id: 'memory', label: 'Memory Matrix' },
    { id: 'stacker', label: 'Coffee Stacker' }
  ];

  return (
    <div>
      <div className="tactile-card" style={{ padding: '18px 16px', marginBottom: '16px' }}>
        <h2 className="font-serif" style={{ fontSize: '24px', fontWeight: 700, color: 'var(--ink)', textAlign: 'center', marginBottom: '4px' }}>
          Tabletop Arcade
        </h2>
        <p style={{ fontSize: '12px', color: 'var(--ink3)', textAlign: 'center', marginBottom: '16px' }}>
          Play games while our master chefs prepare your order.
        </p>

        {/* Game selector pills */}
        <div
          style={{
            display: 'flex',
            gap: '6px',
            background: 'var(--cream-surface)',
            padding: '4px',
            borderRadius: '16px',
            marginBottom: '18px'
          }}
        >
          {games.map((g) => {
            const isSel = activeGame === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setActiveGame(g.id)}
                style={{
                  flex: 1,
                  padding: '8px 4px',
                  borderRadius: '12px',
                  border: 'none',
                  background: isSel ? '#FFFFFF' : 'none',
                  color: isSel ? 'var(--ember-ink)' : 'var(--ink3)',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: isSel ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                {g.label}
              </button>
            );
          })}
        </div>

        {/* Game Canvas Container */}
        {activeGame === 'catcher' && <CatcherGame />}
        {activeGame === 'memory' && <MemoryGame />}
        {activeGame === 'stacker' && <CoffeeStacker />}
      </div>
    </div>
  );
}
