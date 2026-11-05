import React, { useState, useRef, useEffect } from 'react';
import { useSession } from '../../context/SessionContext';
import { triggerHaptic } from '../../lib/haptics';
import { X, Trash2, Plus, Minus, ArrowRight } from 'lucide-react';
import ConfirmOrderModal from './ConfirmOrderModal';

export default function CartSheet({ isOpen, onClose, onOrderSent }) {
  const { cartDetails, addToCart, removeFromCart, clearCart, submitOrder, isSubmitting, showToast } = useSession();

  const [name, setName] = useState(() => {
    if (typeof window !== 'undefined') {
      const search = window.location.search || (window.location.href.includes('?') ? window.location.href.split('?')[1] : '');
      const p = new URLSearchParams(search);
      if (p.get('name')) return p.get('name');
    }
    return localStorage.getItem('ember_name') || '';
  });
  const [phone, setPhone] = useState(() => {
    if (typeof window !== 'undefined') {
      const search = window.location.search || (window.location.href.includes('?') ? window.location.href.split('?')[1] : '');
      const p = new URLSearchParams(search);
      if (p.get('phone')) return p.get('phone');
    }
    return localStorage.getItem('ember_phone') || '';
  });
  const [notes, setNotes] = useState('');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [cachedTotal, setCachedTotal] = useState(() => cartDetails.total || 0);

  useEffect(() => {
    if (cartDetails.total > 0) {
      setCachedTotal(cartDetails.total);
    }
  }, [cartDetails.total]);

  const drawerRef = useRef(null);
  const startYRef = useRef(0);
  const currentDeltaRef = useRef(0);
  const isDraggingRef = useRef(false);

  // Sync drawer state with isOpen and isConfirmOpen
  useEffect(() => {
    if (drawerRef.current) {
      if (isOpen && !isConfirmOpen) {
        drawerRef.current.style.transition = 'transform 0.38s cubic-bezier(0.25, 1, 0.5, 1)';
        drawerRef.current.style.transform = 'translate(-50%, 0)';
      } else {
        drawerRef.current.style.transition = 'transform 0.32s cubic-bezier(0.25, 1, 0.5, 1)';
        drawerRef.current.style.transform = 'translate(-50%, 105%)';
      }
    }
  }, [isOpen, isConfirmOpen]);

  useEffect(() => {
    if (!isOpen) {
      setIsConfirmOpen(false);
    }
  }, [isOpen]);

  // Gesture: Slide down to dismiss
  const handleDragStart = (e) => {
    if (!drawerRef.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}

    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    currentDeltaRef.current = 0;
    drawerRef.current.style.transition = 'none';
  };

  const handleDragMove = (e) => {
    if (!isDraggingRef.current || !drawerRef.current) return;
    const delta = e.clientY - startYRef.current;
    if (delta > 0) {
      currentDeltaRef.current = delta;
      drawerRef.current.style.transform = `translate(-50%, ${delta}px)`;
    } else {
      // Gentle rubber band resistance when pulling upward
      const resistance = delta * 0.15;
      currentDeltaRef.current = resistance;
      drawerRef.current.style.transform = `translate(-50%, ${resistance}px)`;
    }
  };

  const handleDragEnd = (e) => {
    if (!isDraggingRef.current || !drawerRef.current) return;
    isDraggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}

    drawerRef.current.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';

    // Threshold to close: 90px pull down
    if (currentDeltaRef.current > 90) {
      triggerHaptic('light');
      drawerRef.current.style.transform = 'translate(-50%, 105%)';
      onClose();
    } else {
      drawerRef.current.style.transform = 'translate(-50%, 0)';
    }
  };

  const normalizePhoneNumber = (raw) => {
    let digits = (raw || '').replace(/[^0-9]/g, '');
    if (digits.length === 12 && digits.startsWith('91')) {
      digits = digits.slice(2);
    } else if (digits.length === 11 && digits.startsWith('0')) {
      digits = digits.slice(1);
    }
    return digits;
  };

  const handleValidate = () => {
    if (cartDetails.items.length === 0) {
      showToast('Please add items to your cart first');
      triggerHaptic('warning');
      return;
    }
    const cleanPhone = normalizePhoneNumber(phone);
    if (!name.trim()) {
      showToast('Please enter your name');
      triggerHaptic('warning');
      return;
    }
    if (cleanPhone.length !== 10) {
      showToast('Please enter a valid 10-digit mobile number');
      triggerHaptic('warning');
      return;
    }

    localStorage.setItem('ember_name', name.trim());
    localStorage.setItem('ember_phone', cleanPhone);
    setPhone(cleanPhone);
    triggerHaptic('medium');
    setIsConfirmOpen(true);
  };

  const handleExecuteOrder = async () => {
    const cleanPhone = normalizePhoneNumber(phone);
    triggerHaptic('success');
    const orderId = await submitOrder({
      name: name.trim(),
      phone: cleanPhone,
      notes: notes.trim()
    });
    if (orderId) {
      setIsConfirmOpen(false);
      onClose();
      onOrderSent(orderId);
    }
  };

  return (
    <>
      <div className={`bottom-sheet-overlay ${isOpen && !isConfirmOpen ? 'open' : ''}`} onClick={onClose} />
      <div
        ref={drawerRef}
        className={`bottom-sheet-drawer ${isOpen ? 'open' : ''}`}
      >
        {/* Touch gesture drag handle area */}
        <div
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          style={{
            touchAction: 'none',
            padding: '4px 0 12px',
            cursor: 'grab',
            userSelect: 'none'
          }}
        >
          <div className="sheet-grip-bar" style={{ margin: '0 auto 8px', width: '48px', height: '5px', borderRadius: '3px' }} />
          <div style={{ textAlign: 'center', fontSize: '10.5px', color: 'var(--ink3)', fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
            Pull down to dismiss
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div>
            <h2 className="font-serif" style={{ fontSize: '24px', fontWeight: 700, color: 'var(--ink)' }}>
              Your Order Ticket
            </h2>
            <p style={{ fontSize: '11.5px', color: 'var(--ink3)' }}>
              {cartDetails.count} {cartDetails.count === 1 ? 'item' : 'items'} selected
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--ink3)',
              cursor: 'pointer',
              padding: '6px'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Items List */}
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: '16px', maxHeight: '35vh' }}>
          {cartDetails.items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 10px', color: 'var(--ink3)' }}>
              <p style={{ fontSize: '13.5px', fontWeight: 600 }}>Your cart is empty.</p>
              <p style={{ fontSize: '12px', marginTop: '4px' }}>Add some dishes from the menu!</p>
            </div>
          ) : (
            cartDetails.items.map((item) => (
              <div
                key={`${item.category}||${item.name}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: '1px dashed rgba(0,0,0,0.08)'
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--ink)' }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--ink3)' }}>
                    {item.category} · ₹{item.price} each
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontWeight: 700, color: 'var(--ember-ink)', fontSize: '14px' }}>
                    ₹{item.subtotal}
                  </span>
                  <div className="tactile-stepper">
                    <button
                      type="button"
                      className="ts-btn"
                      onClick={() => {
                        triggerHaptic('light');
                        removeFromCart(item);
                      }}
                    >
                      <Minus size={12} />
                    </button>
                    <span className="ts-count">{item.quantity}</span>
                    <button
                      type="button"
                      className="ts-btn ts-add"
                      onClick={() => {
                        triggerHaptic('light');
                        addToCart(item);
                      }}
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Guest Details Form */}
        {cartDetails.items.length > 0 && (
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--ink2)', marginBottom: '6px' }}>
              Please enter your original details.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              <input
                type="text"
                className="search-debossed"
                placeholder="Your Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ padding: '10px 14px', fontSize: '13px' }}
              />
              <input
                type="tel"
                maxLength={10}
                className="search-debossed"
                placeholder="10-digit mobile"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
                style={{ padding: '10px 14px', fontSize: '13px' }}
              />
            </div>
            <input
              type="text"
              className="search-debossed"
              placeholder="Cooking notes (e.g. less spicy, extra hot)…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ padding: '10px 14px', fontSize: '12.5px' }}
            />
          </div>
        )}

        {/* Bill Summary & Submission */}
        {cartDetails.items.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--ink3)' }}>
                Subtotal
              </span>
              <span style={{ fontSize: '22px', fontWeight: 700, color: 'var(--ember-ink)' }}>
                ₹{cartDetails.total}
              </span>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--ink3)', marginBottom: '12px', lineHeight: '1.4' }}>
              Prices shown are exclusive of GST. GST will be charged extra on the final bill.
            </div>

            <button
              type="button"
              className="action-btn-primary"
              style={{ width: '100%', padding: '14px', fontSize: '14px' }}
              onClick={handleValidate}
            >
              <span>Send Order to Kitchen</span>
              <ArrowRight size={17} />
            </button>

            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                clearCart();
              }}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                color: 'var(--ink3)',
                fontSize: '11.5px',
                fontWeight: 600,
                padding: '10px 0 0',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px'
              }}
            >
              <Trash2 size={13} />
              Clear Cart
            </button>
          </div>
        )}
      </div>

      <ConfirmOrderModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleExecuteOrder}
        customerName={name}
        customerPhone={phone}
        totalAmount={cartDetails.total || cachedTotal}
        isSubmitting={isSubmitting}
      />
    </>
  );
}
