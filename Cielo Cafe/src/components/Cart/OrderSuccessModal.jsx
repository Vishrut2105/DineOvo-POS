import React from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, ArrowRight, Gamepad2, X } from 'lucide-react';

export default function OrderSuccessModal({ isOpen, orderId, onClose, onTrackOrder, onPlayGames }) {
  if (!isOpen) return null;

  return createPortal(
    <>
      <div
        className="overlay-blur open"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(23, 25, 28, 0.65)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 9998,
          opacity: 1,
          pointerEvents: 'auto'
        }}
      />
      <div
        className="modal-center-card open"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          zIndex: 9999,
          opacity: 1,
          pointerEvents: 'auto',
          width: 'calc(100% - 32px)',
          maxWidth: '380px'
        }}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: 'var(--cream-surface)',
            border: 'none',
            color: 'var(--ink2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
          aria-label="Close confirmation"
        >
          <X size={16} />
        </button>

        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'rgba(21, 154, 106, 0.12)',
            color: 'var(--success)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: '0 6px 18px rgba(21, 154, 106, 0.2)'
          }}
        >
          <CheckCircle2 size={36} />
        </div>

        <h3 className="font-serif" style={{ fontSize: '26px', fontWeight: 700, color: 'var(--ink)', marginBottom: '6px' }}>
          Sent to Kitchen!
        </h3>

        <p style={{ fontSize: '13px', color: 'var(--ink3)', lineHeight: 1.45, marginBottom: '8px' }}>
          Your order has been transmitted directly to our kitchen displays.
        </p>

        {orderId && (
          <div
            style={{
              display: 'inline-block',
              background: 'var(--cream-surface)',
              padding: '4px 12px',
              borderRadius: '10px',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--ink2)',
              marginBottom: '22px'
            }}
          >
            Ticket #{String(orderId).substring(0, 8).toUpperCase()}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            type="button"
            className="action-btn-primary"
            onClick={onTrackOrder}
            style={{ width: '100%', padding: '13px' }}
          >
            <span>Track Live Order</span>
            <ArrowRight size={16} />
          </button>

          <button
            type="button"
            className="action-btn-glass"
            onClick={onPlayGames}
            style={{ width: '100%', padding: '12px' }}
          >
            <Gamepad2 size={16} color="var(--ember)" />
            <span>Play Arcade While You Wait</span>
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
