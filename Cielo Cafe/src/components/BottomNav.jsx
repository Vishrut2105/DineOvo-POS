import React, { useRef, useEffect } from 'react';
import { useSession } from '../context/SessionContext';
import { triggerHaptic } from '../lib/haptics';
import { Utensils, ReceiptText, Heart, Gamepad2 } from 'lucide-react';

export default function BottomNav({ activeTab, setActiveTab }) {
  const { orders } = useSession();
  const dockRef = useRef(null);
  const bubbleRef = useRef(null);
  const isDraggingRef = useRef(false);
  const latestProgressRef = useRef(0);
  const lastHapticIdxRef = useRef(0);
  const rafIdRef = useRef(null);

  const activeOrdersCount = orders.filter(o => ['pending', 'preparing', 'served'].includes(o.status)).length;

  const tabs = [
    { id: 'menu', label: 'Menu', icon: Utensils },
    { id: 'orders', label: 'Orders', icon: ReceiptText, badge: activeOrdersCount },
    { id: 'reviews', label: 'Connect', icon: Heart },
    { id: 'arcade', label: 'Arcade', icon: Gamepad2 }
  ];

  const activeIndex = tabs.findIndex(t => t.id === activeTab);

  // Position bubble on active tab change when not dragging
  useEffect(() => {
    lastHapticIdxRef.current = activeIndex;
    if (bubbleRef.current && !isDraggingRef.current) {
      bubbleRef.current.style.transition = 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)';
      bubbleRef.current.style.transform = `translate3d(${activeIndex * 100}%, 0, 0)`;
      latestProgressRef.current = activeIndex;
    }
  }, [activeIndex]);

  // Touch glide pointer handlers (Zero React re-render during drag!)
  const handlePointerDown = (e) => {
    if (!dockRef.current || !bubbleRef.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}

    isDraggingRef.current = true;
    bubbleRef.current.style.transition = 'none';

    const rect = dockRef.current.getBoundingClientRect();
    const trackWidth = rect.width - 10;
    const tabWidth = trackWidth / 4;
    const relX = e.clientX - rect.left - 5;
    const progress = Math.max(0, Math.min(3, (relX - tabWidth / 2) / tabWidth));
    latestProgressRef.current = progress;
    lastHapticIdxRef.current = Math.round(progress);

    bubbleRef.current.style.transform = `translate3d(${progress * 100}%, 0, 0) scaleX(1.03)`;
  };

  const handlePointerMove = (e) => {
    if (!isDraggingRef.current || !dockRef.current || !bubbleRef.current) return;

    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);

    rafIdRef.current = requestAnimationFrame(() => {
      if (!dockRef.current || !bubbleRef.current) return;
      const rect = dockRef.current.getBoundingClientRect();
      const trackWidth = rect.width - 10;
      const tabWidth = trackWidth / 4;
      const relX = e.clientX - rect.left - 5;
      const progress = Math.max(0, Math.min(3, (relX - tabWidth / 2) / tabWidth));
      latestProgressRef.current = progress;

      // Haptic tick whenever crossing into an adjacent tab
      const currentSlot = Math.round(progress);
      if (currentSlot !== lastHapticIdxRef.current) {
        lastHapticIdxRef.current = currentSlot;
        triggerHaptic('light');
      }

      // 60-120fps hardware accelerated GPU translate!
      bubbleRef.current.style.transform = `translate3d(${progress * 100}%, 0, 0) scaleX(1.03)`;
    });
  };

  const handlePointerUp = (e) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}

    const targetIdx = Math.max(0, Math.min(3, Math.round(latestProgressRef.current)));

    if (bubbleRef.current) {
      bubbleRef.current.style.transition = 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)';
      bubbleRef.current.style.transform = `translate3d(${targetIdx * 100}%, 0, 0)`;
    }

    if (tabs[targetIdx] && tabs[targetIdx].id !== activeTab) {
      triggerHaptic('medium');
      setActiveTab(tabs[targetIdx].id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handlePointerCancel = (e) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}

    if (bubbleRef.current) {
      bubbleRef.current.style.transition = 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)';
      bubbleRef.current.style.transform = `translate3d(${activeIndex * 100}%, 0, 0)`;
    }
  };

  return (
    <nav
      ref={dockRef}
      className="bottom-nav-dock"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div
        ref={bubbleRef}
        className="nav-slider-bubble"
        style={{
          transform: `translate3d(${activeIndex * 100}%, 0, 0)`
        }}
      />

      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            className={`nav-item-btn ${isActive ? 'active' : ''}`}
            onClick={() => {
              if (activeTab !== tab.id) {
                triggerHaptic('light');
                setActiveTab(tab.id);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
          >
            <div className="nav-icon-wrap">
              <Icon size={19} strokeWidth={isActive ? 2.4 : 2} />
              {Boolean(tab.badge) && tab.badge > 0 && (
                <span className="nav-counter-badge">
                  {tab.badge}
                </span>
              )}
            </div>
            <span className="nav-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
