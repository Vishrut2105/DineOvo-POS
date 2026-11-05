import React from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '../context/SessionContext';
import { Bell, Sparkles, Receipt, X } from 'lucide-react';

export default function TableActionModal({ isOpen, actionType, onClose, onConfirm, isSubmitting }) {
  const { activeTable, formattedTable } = useSession();

  if (!isOpen) return null;

  const titles = {
    waiter: { title: 'Call a Waiter', desc: 'A server will visit your table momentarily to assist you.', icon: Bell, color: 'var(--ember)' },
    clean: { title: 'Clean Table', desc: 'Staff will be notified to wipe and clear your table.', icon: Sparkles, color: 'var(--info)' },
    bill: { title: 'Request Bill', desc: 'The cashier will prepare and print your final bill.', icon: Receipt, color: 'var(--success)' }
  };

  const current = titles[actionType] || titles.waiter;
  const IconComp = current.icon;

  return createPortal(
    <>
      <div className="overlay-blur open" onClick={onClose} />
      <div className="modal-center-card open">
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'none',
            border: 'none',
            color: 'var(--ink3)',
            cursor: 'pointer',
            padding: '4px'
          }}
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
              color: current.color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 14px',
              boxShadow: '0 4px 14px rgba(139, 94, 52, 0.15)'
            }}
          >
            <IconComp size={26} />
          </div>

          <h3 className="font-serif" style={{ fontSize: '24px', fontWeight: 700, color: 'var(--ink)', marginBottom: '6px' }}>
            {current.title}
          </h3>

          <div
            style={{
              display: 'inline-block',
              padding: '4px 12px',
              borderRadius: '10px',
              background: 'var(--cream-surface)',
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--ember-ink)',
              marginBottom: '12px'
            }}
          >
            {formattedTable === 'Takeaway' ? 'Takeaway' : `Table ${activeTable}`}
          </div>

          <p style={{ fontSize: '12.5px', color: 'var(--ink3)', lineHeight: 1.45, marginBottom: '20px' }}>
            {current.desc}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <button
              type="button"
              className="action-btn-glass"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="action-btn-primary"
              onClick={onConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Sending…' : 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
