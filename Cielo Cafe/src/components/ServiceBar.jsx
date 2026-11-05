import React, { useState } from 'react';
import { useSession } from '../context/SessionContext';
import { Bell, Sparkles, Receipt } from 'lucide-react';
import TableActionModal from './TableActionModal';

export default function ServiceBar() {
  const { sendStaffRequest } = useSession();
  const [selectedAction, setSelectedAction] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOpenAction = (type) => {
    setSelectedAction(type);
  };

  const handleClose = () => {
    if (!isSubmitting) setSelectedAction(null);
  };

  const handleConfirm = async () => {
    if (!selectedAction || isSubmitting) return;
    setIsSubmitting(true);
    await sendStaffRequest(selectedAction);
    setIsSubmitting(false);
    setSelectedAction(null);
  };

  return (
    <>
      <div
        className="tactile-card"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px',
          padding: '8px',
          marginBottom: '16px'
        }}
      >
        <button
          type="button"
          onClick={() => handleOpenAction('waiter')}
          style={{
            background: 'none',
            border: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '10px 4px',
            borderRadius: '14px',
            cursor: 'pointer',
            transition: 'background 0.15s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--ember-soft)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
        >
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              background: 'var(--ember-soft)',
              color: 'var(--ember)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Bell size={16} />
          </div>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink)' }}>
            Call Waiter
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleOpenAction('clean')}
          style={{
            background: 'none',
            border: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '10px 4px',
            borderRadius: '14px',
            cursor: 'pointer',
            transition: 'background 0.15s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--cream-surface)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
        >
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              background: 'var(--cream-surface)',
              color: 'var(--info)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Sparkles size={16} />
          </div>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink)' }}>
            Clean Table
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleOpenAction('bill')}
          style={{
            background: 'none',
            border: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '10px 4px',
            borderRadius: '14px',
            cursor: 'pointer',
            transition: 'background 0.15s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(21, 154, 106, 0.08)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
        >
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              background: 'rgba(21, 154, 106, 0.1)',
              color: 'var(--success)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Receipt size={16} />
          </div>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink)' }}>
            Request Bill
          </span>
        </button>
      </div>

      <TableActionModal
        isOpen={Boolean(selectedAction)}
        actionType={selectedAction}
        onClose={handleClose}
        onConfirm={handleConfirm}
        isSubmitting={isSubmitting}
      />
    </>
  );
}
