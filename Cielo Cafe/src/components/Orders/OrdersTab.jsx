import React, { useState, useRef, useEffect } from 'react';
import { useSession } from '../../context/SessionContext';
import { triggerHaptic } from '../../lib/haptics';
import {
  Plus,
  Bell,
  RefreshCw,
  UtensilsCrossed,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChefHat,
  Sparkles,
  Trash2
} from 'lucide-react';
import TableActionModal from '../TableActionModal';

// 2-Second Hold-to-Cancel Button (Misclick Protection)
function HoldToCancelButton({ orderId, orderNumber, onCancel }) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const rafRef = useRef(null);

  const startHold = (e) => {
    // Only respond to primary touch/mouse button
    if (e.button && e.button !== 0) return;
    setHolding(true);
    setProgress(0);
    triggerHaptic('light');
    startTimeRef.current = Date.now();

    const updateProgress = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const pct = Math.min(100, (elapsed / 2000) * 100);
      setProgress(pct);

      if (elapsed >= 2000) {
        // 2 Seconds reached! Execute cancel
        triggerHaptic('heavy');
        setHolding(false);
        setProgress(0);
        onCancel(orderId);
      } else {
        rafRef.current = requestAnimationFrame(updateProgress);
      }
    };

    rafRef.current = requestAnimationFrame(updateProgress);
  };

  const endHold = () => {
    if (!holding) return;
    setHolding(false);
    setProgress(0);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    startTimeRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div style={{ position: 'relative', marginTop: '10px' }}>
      <button
        type="button"
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: 'relative',
          width: '100%',
          padding: '10px 14px',
          borderRadius: '12px',
          border: '1px solid rgba(220, 38, 38, 0.25)',
          background: 'rgba(254, 242, 242, 0.7)',
          color: '#DC2626',
          fontSize: '12px',
          fontWeight: 700,
          cursor: 'pointer',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '7px',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          touchAction: 'none',
          transition: 'transform 0.1s ease'
        }}
      >
        {/* Progress Fill Bar */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${progress}%`,
            background: 'rgba(220, 38, 38, 0.22)',
            transition: holding ? 'none' : 'width 0.2s ease-out',
            pointerEvents: 'none'
          }}
        />

        <Trash2 size={13} style={{ position: 'relative', zIndex: 1 }} />
        <span style={{ position: 'relative', zIndex: 1 }}>
          {holding ? `Keep holding to cancel… (${Math.ceil(2 - (progress * 2 / 100))}s)` : 'Hold 2s to Cancel Order'}
        </span>
      </button>
      <div style={{ fontSize: '10px', color: 'var(--ink3)', textAlign: 'center', marginTop: '3px' }}>
        Press & hold to prevent accidental cancellation
      </div>
    </div>
  );
}

export default function OrdersTab({ onBrowseMenu }) {
  const {
    activeTable,
    formattedTable,
    orders,
    dismissOrder,
    cancelOrder,
    setMergeOrderId,
    resetDiningSession,
    sendStaffRequest,
    syncCloudOrders
  } = useSession();

  const [qaAction, setQaAction] = useState(null);
  const [isQaSubmitting, setIsQaSubmitting] = useState(false);
  const [dismissTargetOrder, setDismissTargetOrder] = useState(null);

  const activeOrders = orders.filter(o => ['pending', 'preparing', 'served'].includes(o.status));
  const completedOrders = orders.filter(o => o.status === 'completed' || o.status === 'done');
  const cancelledOrders = orders.filter(o => o.status === 'cancelled');
  const sessionTotal = orders.reduce((sum, o) => (o.status !== 'cancelled' ? sum + (o.total || 0) : sum), 0);

  const handleAddMore = (orderId) => {
    setMergeOrderId(orderId);
    onBrowseMenu();
  };

  const handleConfirmStaffAction = async () => {
    if (!qaAction) return;
    setIsQaSubmitting(true);
    await sendStaffRequest(qaAction);
    setIsQaSubmitting(false);
    setQaAction(null);
  };

  const handleConfirmDismiss = () => {
    if (dismissTargetOrder) {
      dismissOrder(dismissTargetOrder.id);
      setDismissTargetOrder(null);
    }
  };

  const formatDate = (isoStr) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  };

  const renderStatusMessage = (status) => {
    switch (status) {
      case 'preparing':
        return (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '12px',
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              color: '#B45309',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              fontWeight: 600,
              margin: '10px 0'
            }}
          >
            <ChefHat size={16} />
            <span><b>Preparing in Kitchen:</b> Our chef is actively crafting your dishes.</span>
          </div>
        );
      case 'served':
        return (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '12px',
              background: 'rgba(21, 154, 106, 0.1)',
              border: '1px solid rgba(21, 154, 106, 0.25)',
              color: '#0D7A53',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              fontWeight: 600,
              margin: '10px 0'
            }}
          >
            <Sparkles size={16} />
            <span><b>Served:</b> Dishes served at your table. Enjoy your meal!</span>
          </div>
        );
      case 'completed':
      case 'done':
        return (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '12px',
              background: 'rgba(21, 154, 106, 0.08)',
              border: '1px solid rgba(21, 154, 106, 0.2)',
              color: '#0D7A53',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              fontWeight: 600,
              margin: '10px 0'
            }}
          >
            <CheckCircle2 size={16} />
            <span><b>Order Completed:</b> Thank you for dining with us.</span>
          </div>
        );
      case 'pending':
      default:
        return (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '12px',
              background: 'rgba(224, 90, 43, 0.08)',
              border: '1px solid rgba(224, 90, 43, 0.2)',
              color: 'var(--ember-ink)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              fontWeight: 600,
              margin: '10px 0'
            }}
          >
            <Clock size={16} />
            <span><b>Order Placed:</b> Kitchen has received your ticket and is preparing your order.</span>
          </div>
        );
    }
  };

  return (
    <div>
      {/* Session Status Banner */}
      <div
        className="tactile-card"
        style={{
          padding: '16px 18px',
          marginBottom: '16px',
          background: 'linear-gradient(135deg, #FFFFFF 0%, var(--cream-surface) 100%)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: '8px',
                background: 'var(--ember-soft)',
                color: 'var(--ember-ink)'
              }}
            >
              {formattedTable === 'Takeaway' ? 'Takeaway' : `Table ${activeTable}`}
            </span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink3)' }}>
              Active Dining Session
            </span>
          </div>
          <button
            type="button"
            onClick={syncCloudOrders}
            title="Refresh order status"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--ink3)',
              cursor: 'pointer',
              padding: '4px'
            }}
          >
            <RefreshCw size={14} />
          </button>
        </div>

        <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)' }}>
          {activeOrders.length > 0
            ? `${activeOrders.length} Active Ticket${activeOrders.length > 1 ? 's' : ''} · Bill: ₹${sessionTotal}`
            : orders.length > 0
            ? `All Items Served · Bill: ₹${sessionTotal}`
            : 'Table Ready — No Active Tickets'}
        </div>
      </div>

      {/* Orders List */}
      {orders.length === 0 ? (
        <div className="tactile-card" style={{ textAlign: 'center', padding: '42px 20px', marginBottom: '16px' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              background: 'var(--ember-soft)',
              color: 'var(--ember)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 14px'
            }}
          >
            <UtensilsCrossed size={26} />
          </div>
          <h3 className="font-serif" style={{ fontSize: '24px', fontWeight: 700, color: 'var(--ink)', marginBottom: '6px' }}>
            {formattedTable === 'Takeaway' ? 'Takeaway' : `Table ${activeTable}`} Ready
          </h3>
          <p style={{ fontSize: '12.5px', color: 'var(--ink3)', lineHeight: 1.45, marginBottom: '20px' }}>
            No kitchen tickets placed on this session yet. Explore our handcrafted menu and order your dishes.
          </p>
          <button
            type="button"
            className="action-btn-primary"
            onClick={onBrowseMenu}
            style={{ padding: '12px 24px', margin: '0 auto' }}
          >
            Browse Menu & Order
          </button>
        </div>
      ) : (
        <>
          {/* Active Orders */}
          {activeOrders.map((order) => {
            const shortId = String(order.id).substring(0, 8).toUpperCase();

            return (
              <div key={order.id} className="tactile-card" style={{ padding: '16px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink3)' }}>
                      #{shortId}
                    </span>
                    {order.created_at && (
                      <span style={{ fontSize: '11px', color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <Clock size={11} />
                        {formatDate(order.created_at)}
                      </span>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: '8px',
                      background: order.status === 'served' ? 'rgba(21,154,106,0.1)' : 'var(--ember-soft)',
                      color: order.status === 'served' ? 'var(--success)' : 'var(--ember-ink)',
                      textTransform: 'capitalize'
                    }}
                  >
                    {order.status}
                  </span>
                </div>

                {/* Simple Food Preparation State Message */}
                {renderStatusMessage(order.status)}

                {/* Items Box */}
                <div
                  style={{
                    background: 'var(--cream-surface)',
                    borderRadius: '14px',
                    padding: '12px 14px',
                    margin: '12px 0 12px'
                  }}
                >
                  {(order.items || []).map((it, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '4px 0',
                        fontSize: '12.5px'
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 700, color: 'var(--ember-ink)', marginRight: '6px' }}>
                          {it.quantity}x
                        </span>
                        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
                          {it.name}
                        </span>
                      </div>
                      <span style={{ fontWeight: 700, color: 'var(--ink)' }}>
                        ₹{(it.price || 0) * (it.quantity || 1)}
                      </span>
                    </div>
                  ))}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingTop: '8px',
                      marginTop: '6px',
                      borderTop: '1px dashed rgba(0,0,0,0.1)'
                    }}
                  >
                    <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 700, color: 'var(--ink3)' }}>
                      Ticket Total
                    </span>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ember-ink)' }}>
                      ₹{order.total}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    type="button"
                    className="action-btn-primary"
                    onClick={() => handleAddMore(order.id)}
                    style={{ padding: '9px 12px', fontSize: '12px' }}
                  >
                    <Plus size={14} />
                    Add More Items
                  </button>
                  <button
                    type="button"
                    className="action-btn-glass"
                    onClick={() => setQaAction('waiter')}
                    style={{ padding: '9px 12px', fontSize: '12px' }}
                  >
                    <Bell size={14} />
                    Call Waiter
                  </button>
                </div>

                {/* 2-Second Hold-to-Cancel Button (Misclick Prevention) */}
                {['pending', 'preparing'].includes(order.status) && (
                  <HoldToCancelButton
                    orderId={order.id}
                    orderNumber={shortId}
                    onCancel={(id) => cancelOrder(id)}
                  />
                )}

                {/* Dismiss Ticket Link */}
                <div style={{ textAlign: 'center', marginTop: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setDismissTargetOrder(order)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--ink3)',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textDecoration: 'underline'
                    }}
                  >
                    Dismiss this ticket
                  </button>
                </div>
              </div>
            );
          })}

          {/* Completed Orders */}
          {completedOrders.length > 0 && (
            <div style={{ marginTop: '22px' }}>
              <h3 className="font-serif" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--ink)', marginBottom: '10px' }}>
                Completed Tickets
              </h3>
              {completedOrders.map((order) => (
                <div
                  key={order.id}
                  className="tactile-card"
                  style={{ padding: '14px 16px', marginBottom: '10px', opacity: 0.9 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <CheckCircle2 size={14} color="var(--success)" />
                      <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--ink)' }}>
                        #{String(order.id).substring(0, 8).toUpperCase()}
                      </span>
                    </div>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>
                      ₹{order.total}
                    </span>
                  </div>

                  <div style={{ fontSize: '11.5px', color: 'var(--ink3)', marginBottom: '8px' }}>
                    {(order.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ')}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => setDismissTargetOrder(order)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--ink3)',
                        fontSize: '10.5px',
                        cursor: 'pointer'
                      }}
                    >
                      Clear record
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Cancelled Orders */}
          {cancelledOrders.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <h3 className="font-serif" style={{ fontSize: '16px', fontWeight: 700, color: '#C0392B', marginBottom: '8px' }}>
                Cancelled Tickets
              </h3>
              {cancelledOrders.map((order) => (
                <div
                  key={order.id}
                  className="tactile-card"
                  style={{ padding: '12px 14px', marginBottom: '8px', opacity: 0.85, borderColor: 'rgba(217, 50, 50, 0.2)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <XCircle size={14} color="#D93232" />
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink)' }}>
                        #{String(order.id).substring(0, 8).toUpperCase()}
                      </span>
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#D93232', background: 'rgba(217, 50, 50, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                      Cancelled
                    </span>
                  </div>

                  <div style={{ fontSize: '11px', color: 'var(--ink3)', marginBottom: '6px' }}>
                    {(order.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ')}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => setDismissTargetOrder(order)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--ink3)',
                        fontSize: '10.5px',
                        cursor: 'pointer'
                      }}
                    >
                      Clear record
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Reset / Fresh Session Footer */}
          <div style={{ textAlign: 'center', margin: '24px 0 10px' }}>
            <button
              type="button"
              className="action-btn-glass"
              onClick={() => resetDiningSession(false)}
              style={{ padding: '10px 18px', fontSize: '12px' }}
            >
              <RefreshCw size={13} />
              Start Fresh Dining Session
            </button>
          </div>
        </>
      )}

      {/* Staff Action Modal */}
      <TableActionModal
        isOpen={Boolean(qaAction)}
        actionType={qaAction}
        onClose={() => setQaAction(null)}
        onConfirm={handleConfirmStaffAction}
        isSubmitting={isQaSubmitting}
      />

      {/* Confirmation Modal for Dismissing Ticket */}
      {dismissTargetOrder && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setDismissTargetOrder(null)}
        >
          <div
            className="tactile-card"
            style={{
              width: '100%',
              maxWidth: '340px',
              padding: '22px 20px',
              textAlign: 'center',
              animation: 'modalSlideUp 0.2s ease-out'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'rgba(224, 90, 43, 0.1)',
                color: 'var(--ember)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px'
              }}
            >
              <AlertTriangle size={24} />
            </div>

            <h3 className="font-serif" style={{ fontSize: '20px', fontWeight: 700, color: 'var(--ink)', marginBottom: '6px' }}>
              Dismiss Ticket?
            </h3>
            <p style={{ fontSize: '12.5px', color: 'var(--ink3)', lineHeight: 1.45, marginBottom: '20px' }}>
              Are you sure you want to dismiss ticket <b>#{String(dismissTargetOrder.id).substring(0, 8).toUpperCase()}</b>?
              This removes the ticket from your phone screen.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button
                type="button"
                className="action-btn-glass"
                onClick={() => setDismissTargetOrder(null)}
                style={{ padding: '11px', fontSize: '13px' }}
              >
                Keep Ticket
              </button>
              <button
                type="button"
                className="action-btn-primary"
                onClick={handleConfirmDismiss}
                style={{ padding: '11px', fontSize: '13px', background: '#DC2626' }}
              >
                Yes, Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
