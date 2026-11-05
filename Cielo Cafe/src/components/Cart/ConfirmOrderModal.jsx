import React from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '../../context/SessionContext';
import { triggerHaptic } from '../../lib/haptics';
import { ChefHat, X, Loader2 } from 'lucide-react';

export default function ConfirmOrderModal({ isOpen, onClose, onConfirm, customerName, customerPhone, totalAmount, isSubmitting }) {
  const { activeTable, formattedTable, mergeOrderId } = useSession();

  if (!isOpen) return null;

  return createPortal(
    <>
      <div
        className="overlay-blur open"
        onClick={() => {
          if (!isSubmitting) {
            triggerHaptic('light');
            onClose();
          }
        }}
      />
      <div className="modal-center-card open">
        <button
          type="button"
          onClick={() => {
            if (!isSubmitting) {
              triggerHaptic('light');
              onClose();
            }
          }}
          disabled={isSubmitting}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'none',
            border: 'none',
            color: 'var(--ink3)',
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            padding: '4px'
          }}
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: 'var(--ember-soft)',
              color: 'var(--ember)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 14px',
              boxShadow: '0 4px 14px rgba(139, 94, 52, 0.15)'
            }}
          >
            <ChefHat size={28} />
          </div>

          <h3 className="font-serif" style={{ fontSize: '24px', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>
            Send to Kitchen?
          </h3>

          <p style={{ fontSize: '12px', color: 'var(--ink3)', marginBottom: '16px' }}>
            {mergeOrderId ? 'Extra items will be added to your current ticket.' : 'Your ticket will be immediately received by kitchen staff.'}
          </p>

          <div
            style={{
              background: 'var(--cream-surface)',
              borderRadius: '16px',
              padding: '14px 16px',
              textAlign: 'left',
              marginBottom: '20px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--ink3)' }}>Location</span>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink)' }}>
                {mergeOrderId ? 'Adding to Order' : formattedTable === 'Takeaway' ? 'Takeaway' : activeTable ? `Table ${activeTable}` : 'No Table Selected'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--ink3)' }}>Guest</span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)' }}>
                {customerName} ({customerPhone})
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingTop: '8px',
                borderTop: '1px dashed rgba(0,0,0,0.1)'
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>Total Amount</span>
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ember-ink)' }}>₹{totalAmount}</span>
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--ink3)', marginTop: '8px', lineHeight: '1.35', fontStyle: 'italic' }}>
              * Prices shown are exclusive of GST. GST will be charged extra on the final bill.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <button
              type="button"
              className="action-btn-glass"
              onClick={() => {
                triggerHaptic('light');
                onClose();
              }}
              disabled={isSubmitting}
            >
              Review Cart
            </button>
            <button
              type="button"
              className="action-btn-primary"
              onClick={() => {
                triggerHaptic('success');
                onConfirm();
              }}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Sending…</span>
                </>
              ) : (
                'Send Order'
              )}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
