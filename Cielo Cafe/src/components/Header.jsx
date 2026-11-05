import React from 'react';
import { useSession } from '../context/SessionContext';
import { RESTAURANT_CONFIG } from '../lib/config';
import { RefreshCw, UtensilsCrossed } from 'lucide-react';

export default function Header() {
  const { activeTable, formattedTable, resetDiningSession } = useSession();

  return (
    <header className="tactile-card" style={{ padding: '16px 18px', marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '14px',
              background: '#FFFFFF',
              border: '1px solid var(--tborder)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(139, 94, 52, 0.15)',
              overflow: 'hidden'
            }}
          >
            <img
              src="/Logo.jpg"
              alt="The Cielo Cafe"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => {
                if (e.target.src.indexOf('logo.png') === -1) {
                  e.target.src = '/logo.png';
                }
              }}
            />
          </div>
          <div>
            <h1 className="font-serif" style={{ fontSize: '22px', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1 }}>
              {RESTAURANT_CONFIG.name}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <p style={{ fontSize: '11.5px', color: 'var(--ink2)', fontWeight: 600, lineHeight: 1.2 }}>
                Cafe &amp; Restro
              </p>
              <span style={{ fontSize: '9.5px', fontWeight: 700, color: 'var(--success)', background: 'rgba(46, 125, 50, 0.1)', border: '1px solid rgba(46, 125, 50, 0.2)', padding: '1px 6px', borderRadius: '4px' }}>
                Pure Veg
              </span>
            </div>
            <p style={{ fontSize: '9px', letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--rose)', fontWeight: 700, marginTop: '2px' }}>
              powered by DINEOVO
            </p>
          </div>
        </div>

        {/* Table Beacon Pill & Fresh Session Action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '6px 12px',
              borderRadius: '14px',
              background: 'var(--ember-soft)',
              border: '1px solid var(--tborder)',
              boxShadow: '0 2px 6px rgba(139, 94, 52, 0.08)'
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ember-ink)' }}>
              {formattedTable === 'Takeaway' ? 'Takeaway' : activeTable ? `Table ${activeTable}` : 'Scan Table QR'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => resetDiningSession(false)}
            title="Start fresh session / Reset table tickets"
            style={{
              background: 'none',
              border: '1px solid var(--glass-border)',
              borderRadius: '12px',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink3)',
              cursor: 'pointer',
              boxShadow: 'var(--skeuo-rim)'
            }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
