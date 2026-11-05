import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag, X, Bell, Droplets, Hand, Sparkles, Volume2 } from 'lucide-react';

/**
 * Universal Notification System
 * ─────────────────────────────────────────
 * Renders premium floating notification banners for:
 *  - New orders
 *  - Reorders (merged rounds)
 *  - Customer requests (waiter call, water, table clean)
 *
 * Designed to work on every page EXCEPT the KDS (Orders) page.
 *
 * Props:
 *  - notifications: Array of notification objects
 *  - onDismiss: (id) => void
 *  - onDismissAll: () => void
 */

// ─── Icon + color config per notification type ──────────────────
function getNotifStyle(notification) {
  if (notification.notifType === 'request') {
    const type = notification.requestType || '';
    if (type === 'waiter') return { Icon: Hand, color: 'amber', label: 'Customer Request', bg: 'bg-amber-500/15', border: 'border-amber-500/25', text: 'text-amber-400', gradient: 'from-amber-400 via-orange-400 to-rose-400' };
    if (type === 'clean')  return { Icon: Sparkles, color: 'violet', label: 'Customer Request', bg: 'bg-violet-500/15', border: 'border-violet-500/25', text: 'text-violet-400', gradient: 'from-violet-400 via-purple-400 to-fuchsia-400' };
    if (type.startsWith('water')) return { Icon: Droplets, color: 'cyan', label: 'Customer Request', bg: 'bg-cyan-500/15', border: 'border-cyan-500/25', text: 'text-cyan-400', gradient: 'from-cyan-400 via-sky-400 to-blue-400' };
    return { Icon: Bell, color: 'amber', label: 'Customer Request', bg: 'bg-amber-500/15', border: 'border-amber-500/25', text: 'text-amber-400', gradient: 'from-amber-400 via-orange-400 to-rose-400' };
  }
  // Order type
  return { Icon: ShoppingBag, color: 'emerald', label: 'New Order', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', text: 'text-emerald-400', gradient: 'from-emerald-400 via-brand-primary to-violet-500' };
}

// ─── Single notification card ───────────────────────────────────
function NotificationCard({ notification, onDismiss, index }) {
  const [progress, setProgress] = useState(100);
  const timerRef = useRef(null);
  const DURATION = 8000; // 8s auto-dismiss
  const TICK = 50;

  useEffect(() => {
    let elapsed = 0;
    timerRef.current = setInterval(() => {
      elapsed += TICK;
      setProgress(Math.max(0, 100 - (elapsed / DURATION) * 100));
      if (elapsed >= DURATION) {
        clearInterval(timerRef.current);
        onDismiss(notification.id);
      }
    }, TICK);

    return () => clearInterval(timerRef.current);
  }, [notification.id, onDismiss]);

  const style = getNotifStyle(notification);
  const { Icon } = style;

  // Build display text
  let title, subtitle;
  if (notification.notifType === 'request') {
    title = notification.requestLabel || 'Customer Request';
    subtitle = notification.table_name
      ? `Table ${notification.table_name}`
      : 'Unknown table';
  } else {
    // Order
    title = notification.table_name
      ? `Table ${notification.table_name}`
      : notification.order_type === 'delivery'
        ? 'Delivery Order'
        : notification.order_type === 'pickup'
          ? 'Pickup Order'
          : 'New Order';
    subtitle = notification.isReorder
      ? `Round ${notification.batch} reorder`
      : notification.item_count
        ? `${notification.item_count} item${notification.item_count > 1 ? 's' : ''} · Just arrived`
        : 'Just arrived';
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.85 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.85, transition: { duration: 0.25 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 30, delay: index * 0.06 }}
      className="relative group"
    >
      <div className="relative overflow-hidden rounded-2xl border border-brand-glass-border bg-brand-card shadow-2xl shadow-black/20 w-[340px]">
        {/* Glow accent */}
        <div className={`absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r ${style.gradient}`} />

        <div className="flex items-start gap-3 p-4">
          {/* Icon */}
          <div className="shrink-0 mt-0.5">
            <div className={`w-10 h-10 rounded-xl ${style.bg} ${style.border} border flex items-center justify-center`}>
              <Icon size={18} className={style.text} />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-bold uppercase tracking-widest ${style.text}`}>
                {style.label}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-brand-text/40">
                <Volume2 size={10} />
              </span>
            </div>
            <p className="text-sm font-bold text-brand-text mt-0.5 truncate">
              {title}
            </p>
            <p className="text-xs text-brand-text/50 font-medium mt-0.5">
              {subtitle}
            </p>
          </div>

          {/* Dismiss */}
          <button
            onClick={() => onDismiss(notification.id)}
            className="shrink-0 p-1.5 rounded-lg text-brand-text/30 hover:text-brand-text hover:bg-brand-secondary/50 transition-all opacity-0 group-hover:opacity-100"
          >
            <X size={14} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-[2px] w-full bg-brand-secondary/30">
          <motion.div
            className={`h-full bg-gradient-to-r ${style.gradient} opacity-60`}
            style={{ width: `${progress}%` }}
            transition={{ duration: 0.05, ease: 'linear' }}
          />
        </div>
      </div>
    </motion.div>
  );
}

// ─── Notification container ─────────────────────────────────────
export default function NewOrderNotification({ notifications, onDismiss, onDismissAll }) {
  if (!notifications || notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2.5 items-end pointer-events-none">
      <AnimatePresence mode="popLayout">
        {notifications.map((n, i) => (
          <div key={n.id} className="pointer-events-auto">
            <NotificationCard
              notification={n}
              onDismiss={onDismiss}
              index={i}
            />
          </div>
        ))}

        {/* "Dismiss all" pill when stacked */}
        {notifications.length > 1 && (
          <motion.button
            key="dismiss-all"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            onClick={onDismissAll}
            className="pointer-events-auto text-[11px] font-bold text-brand-text/50 hover:text-brand-text bg-brand-card/80 backdrop-blur-xl border border-brand-glass-border rounded-full px-4 py-1.5 transition-all hover:bg-brand-secondary/50 shadow-lg"
          >
            Dismiss all ({notifications.length})
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
