import React from 'react';
import { useSession } from '../../context/SessionContext';
import { Plus, Minus } from 'lucide-react';

export default function MenuCard({ item }) {
  const { cart, addToCart, removeFromCart } = useSession();

  const itemKey = `${item.category || 'Other'}||${item.name}`;
  const quantity = cart[itemKey] || 0;

  return (
    <div
      className="tactile-card"
      style={{
        padding: '14px 16px',
        marginBottom: '10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px'
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          {/* 100% Pure Veg indicator */}
          <div
            title="Pure Vegetarian"
            style={{
              width: '14px',
              height: '14px',
              border: '1.5px solid var(--success)',
              borderRadius: '3px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <div
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'var(--success)'
              }}
            />
          </div>

          <h3 style={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.25 }}>
            {item.name}
          </h3>
        </div>

        {item.description && (
          <p
            style={{
              fontSize: '11.5px',
              color: 'var(--ink3)',
              lineHeight: 1.35,
              marginBottom: '6px',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden'
            }}
          >
            {item.description}
          </p>
        )}

        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ember-ink)' }}>
          ₹{item.price}
        </div>
      </div>

      {/* Action / Stepper */}
      <div>
        {quantity > 0 ? (
          <div className="tactile-stepper">
            <button
              type="button"
              className="ts-btn"
              onClick={() => removeFromCart(item)}
              aria-label="Decrease quantity"
            >
              <Minus size={13} />
            </button>
            <span className="ts-count">{quantity}</span>
            <button
              type="button"
              className="ts-btn ts-add"
              onClick={() => addToCart(item)}
              aria-label="Increase quantity"
            >
              <Plus size={13} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="action-btn-glass"
            onClick={() => addToCart(item)}
            style={{ padding: '8px 16px', fontSize: '12.5px', borderRadius: '12px' }}
          >
            <Plus size={14} />
            Add
          </button>
        )}
      </div>
    </div>
  );
}
