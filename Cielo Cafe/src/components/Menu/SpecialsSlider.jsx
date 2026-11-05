import React from 'react';
import { useSession } from '../../context/SessionContext';
import { Sparkles, Plus } from 'lucide-react';

export default function SpecialsSlider({ items }) {
  const { cart, addToCart } = useSession();

  // Strictly filter only items currently marked as today's special in the POS dashboard
  const specials = (items || []).filter(item => Boolean(item.is_todays_special));

  if (specials.length === 0) return null;

  return (
    <div style={{ marginBottom: '22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '0 4px' }}>
        <div
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#5B3700'
          }}
        >
          <Sparkles size={14} />
        </div>
        <h2 className="font-serif" style={{ fontSize: '20px', fontWeight: 700, color: 'var(--ink)' }}>
          Chef's Daily Specials
        </h2>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '12px',
          overflowX: 'auto',
          paddingBottom: '8px',
          scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none'
        }}
      >
        {specials.map((item) => {
          const itemKey = `${item.category || 'Other'}||${item.name}`;
          const inCartCount = cart[itemKey] || 0;

          return (
            <div
              key={item.id || item.name}
              className="tactile-card"
              style={{
                flex: '0 0 240px',
                scrollSnapAlign: 'start',
                padding: '14px',
                background: 'linear-gradient(135deg, #FFFFFF 0%, var(--ember-soft) 100%)',
                border: '1px solid var(--tborder)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                  <span
                    style={{
                      fontSize: '9.5px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.6px',
                      background: 'var(--glass2)',
                      color: 'var(--ember-ink)',
                      padding: '2px 8px',
                      borderRadius: '6px'
                    }}
                  >
                    Special
                  </span>
                  <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ember-ink)' }}>
                    ₹{item.price}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <div
                    title="Pure Vegetarian"
                    style={{
                      width: '12px',
                      height: '12px',
                      border: '1.5px solid var(--success)',
                      borderRadius: '3px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--success)' }} />
                  </div>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.25 }}>
                    {item.name}
                  </h3>
                </div>
                {item.description && (
                  <p
                    style={{
                      fontSize: '11.5px',
                      color: 'var(--ink3)',
                      lineHeight: 1.35,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }}
                  >
                    {item.description}
                  </p>
                )}
              </div>

              <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="action-btn-primary"
                  onClick={() => addToCart(item)}
                  style={{ padding: '8px 14px', fontSize: '12px', borderRadius: '10px' }}
                >
                  <Plus size={14} />
                  {inCartCount > 0 ? `Add (${inCartCount})` : 'Add to Order'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
