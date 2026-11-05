import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react';
import { supabase } from './lib/supabase';
import { loadAppSettings } from './lib/appSettings';
import { mergeLocalAndCloudOrders, patchOrderUpdate, patchOrderItem } from './lib/orderPatching';
import { logSupabaseRead } from './lib/egressLogger';
import {
  markSignOutReason,
  isSignOutPending,
  consumePendingSignOutReason,
  signOutWithReason,
  markSkipNextAutoLogin,
  SIGN_OUT_MANUAL,
  SIGN_OUT_REMOTE,
  getDeviceId,
  getDeviceName,
  registerDeviceSession
} from './lib/session';
import { HashRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { 
  Sun, Moon, BarChart2, DollarSign, Menu, LogOut, Plus, 
  LayoutDashboard, Receipt, TrendingUp, Package, Users, Star,
  CreditCard, Store, FileText, Settings as SettingsIcon, Search, RefreshCw,
  ChevronLeft, ChevronRight, ChefHat, Calendar, X, UploadCloud, AlertTriangle, Bell
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { Toaster, toast } from 'react-hot-toast';
import { subDays } from 'date-fns';

function UpdaterOverlay({ progress, message }) {
  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      className="fixed inset-0 z-9999 flex flex-col items-center justify-center bg-brand-bg/95 backdrop-blur-xl"
    >
      <div className="max-w-md w-full p-8 flex flex-col items-center">
        <motion.div 
          animate={{ rotate: 360 }} 
          transition={{ repeat: Infinity, duration: 8, ease: "linear" }}
          className="w-24 h-24 rounded-full border-4 border-brand-glass-border border-t-brand-primary mb-8 shadow-[0_0_30px_rgba(var(--color-primary),0.3)]"
        />
        <h2 className="text-2xl font-black text-brand-text mb-2 text-center">{message}</h2>
        <div className="w-full h-3 bg-brand-secondary/50 rounded-full overflow-hidden mb-4 border border-brand-glass-border shadow-inner relative">
          <motion.div 
            className="absolute top-0 left-0 bottom-0 bg-brand-primary shadow-[0_0_15px_rgba(var(--color-primary),0.8)]"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ ease: "easeOut", duration: 0.5 }}
          />
        </div>
        <p className="text-brand-text/60 font-medium font-mono text-sm tracking-widest">
          {Math.round(progress)}%
        </p>
      </div>
    </motion.div>
  );
}

// Pages — Orders/Login are first-paint critical (KDS is the landing route, Login is
// the pre-auth screen) so they stay eagerly bundled. The rest only load once the user
// navigates to them, shrinking the initial bundle without changing any visible behavior
// (Electron loads chunks off local disk, so the Suspense gap is imperceptible).
import Orders, { OrderModal } from './pages/Orders';
import Login from './pages/Login';
import TermsModal from './components/TermsModal';
import NewOrderNotification from './components/NewOrderNotification';

const MenuEditor = lazy(() => import('./pages/MenuEditor'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Revenue = lazy(() => import('./pages/Revenue'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Employees = lazy(() => import('./pages/Employees'));
const Salaries = lazy(() => import('./pages/Salaries'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));
const Customers = lazy(() => import('./pages/Customers'));
const Vendors = lazy(() => import('./pages/Vendors'));
const Recipes = lazy(() => import('./pages/Recipes'));
const Reservations = lazy(() => import('./pages/Reservations'));

function AnimatedAppRoutes({
  orders, requests, menuItems, inventory, tables, reservations,
  fetchOrders, fetchRequests, onAddOrder, isLoading,
  fetchMenuItems, fetchTables, daysLeft, expiryDate
}) {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="w-full"
      >
        <Suspense fallback={null}>
          <Routes location={location}>
            <Route path="/" element={<Orders orders={orders} requests={requests} menuItems={menuItems} inventory={inventory} tables={tables} reservations={reservations} fetchOrders={fetchOrders} fetchRequests={fetchRequests} onAddOrder={onAddOrder} isLoading={isLoading} />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/menu" element={<MenuEditor menuItems={menuItems} fetchMenuItems={fetchMenuItems} />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/revenue" element={<Revenue />} />
            <Route path="/inventory" element={<Inventory inventory={inventory} />} />
            <Route path="/recipes" element={<Recipes menuItems={menuItems} inventory={inventory} />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/salaries" element={<Salaries />} />
            <Route path="/reservations" element={<Reservations tables={tables} />} />

            {/* Dummy routes for missing pages */}
            <Route path="/vendors" element={<Vendors />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings tables={tables} refreshTables={fetchTables} daysLeft={daysLeft} expiryDate={expiryDate} />} />
          </Routes>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
}

function App() {
  // Enforce dark theme for the ChaiBugs aesthetic by default
  const [theme, setTheme] = useState('dark');
  const [orders, setOrders] = useState([]);
  const [requests, setRequests] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [isAddOrderOpen, setIsAddOrderOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [inventory, setInventory] = useState([]);
  const [tables, setTables] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [adminProfile, setAdminProfile] = useState(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [isAppLoading, setIsAppLoading] = useState(true);
  const [showTerms, setShowTerms] = useState(false);
  const prevInventoryRef = useRef();
  // Mirrors `session` so listeners can synchronously tell whether we're still logged in
  // without re-subscribing every time the session object changes (Supabase hands out a new
  // one on each hourly token refresh). Used to ignore Realtime events that arrive after
  // we've already signed out.
  const sessionRef = useRef(null);

  // ─── Universal New Order Notification System ───
  const [orderNotifications, setOrderNotifications] = useState([]);
  const chimeAudioRef = useRef(null);
  const lastNotifiedOrderRef = useRef(null);

  // Preload chime audio once for instant playback
  useEffect(() => {
    const audio = new Audio('./chime.mp3');
    audio.volume = 1.0;
    audio.preload = 'auto';
    audio.load();
    chimeAudioRef.current = audio;
  }, []);

  // Clones are held until they finish. An unreferenced audio element can be garbage
  // collected mid-playback, which is why the chime sounded for some orders and not others.
  const pendingChimesRef = useRef(new Set());
  const playGlobalChime = useCallback(() => {
    try {
      if (chimeAudioRef.current) {
        // Clone the audio node so overlapping plays work
        const clone = chimeAudioRef.current.cloneNode();
        clone.volume = 1.0;
        clone.addEventListener('ended', () => pendingChimesRef.current.delete(clone));
        pendingChimesRef.current.add(clone);
        clone.play().catch(() => pendingChimesRef.current.delete(clone));
      }
    } catch (e) { /* autoplay blocked silently */ }
  }, []);

  const pushNotification = useCallback((data) => {
    // Skip if on KDS page
    if (window.location.hash === '#/' || window.location.hash === '' || window.location.hash === '#') return;

    const dedupId = data.dedupId || Date.now();

    // Dedup: don't re-notify the same item within 2 seconds
    if (lastNotifiedOrderRef.current === dedupId) return;
    lastNotifiedOrderRef.current = dedupId;
    setTimeout(() => { if (lastNotifiedOrderRef.current === dedupId) lastNotifiedOrderRef.current = null; }, 2000);

    // Play chime
    playGlobalChime();

    // Build notification
    const n = {
      id: `${dedupId}-${Date.now()}`,
      ...data,
      timestamp: Date.now(),
    };

    // Cap at 5 stacked notifications
    setOrderNotifications(prev => [n, ...prev].slice(0, 5));
  }, [playGlobalChime]);

  const dismissNotification = useCallback((id) => {
    setOrderNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const dismissAllNotifications = useCallback(() => {
    setOrderNotifications([]);
  }, []);

  // Auto Updater State
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateMessage, setUpdateMessage] = useState('Downloading update...');

  // Subscription expiry is read-only from Supabase (`subscription_status` table) —
  // it used to live in localStorage, which meant anyone could unlock the app forever
  // via devtools. Renewal is now a manual server-side action; see
  // database_scripts/supabase_subscription_setup.sql.
  const [expiryDate, setExpiryDate] = useState(null);

  const daysLeft = React.useMemo(() => {
    if (!expiryDate) return Infinity; // not fetched yet — don't lock out prematurely
    const today = new Date();
    today.setHours(0,0,0,0);
    // expiryDate is a bare 'YYYY-MM-DD' string from Supabase — parsed alone that's UTC
    // midnight, not local midnight like `today` above, which skewed the diff by the local
    // UTC offset (e.g. +5:30 in IST) and could round up into an extra day. Appending a
    // time makes JS parse it as local midnight instead, matching `today`.
    const expiry = new Date(expiryDate + 'T00:00:00');
    const diffTime = expiry - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }, [expiryDate]);

  useEffect(() => {
    // Only show toast once per session to avoid re-triggering on re-mount
    const toastKey = `subscription_toast_shown_${daysLeft}`;
    if (sessionStorage.getItem(toastKey)) return;

    if (daysLeft === 5) {
      sessionStorage.setItem(toastKey, '1');
      toast.custom((t) => (
        <div
          className={`${
            t.visible ? 'animate-enter' : 'animate-leave'
          } max-w-md w-full bg-brand-card shadow-2xl rounded-2xl pointer-events-auto flex ring-1 ring-brand-primary/20 overflow-hidden relative`}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-brand-primary/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4"></div>
          <div className="flex-1 w-0 p-4 relative z-10">
            <div className="flex items-start">
              <div className="shrink-0 pt-0.5">
                <div className="w-10 h-10 bg-brand-primary/20 rounded-full flex items-center justify-center border border-brand-primary/30">
                  <AlertTriangle className="text-brand-primary" size={20} />
                </div>
              </div>
              <div className="ml-3 flex-1">
                <p className="text-sm font-black text-brand-text">
                  Subscription Reminder
                </p>
                <p className="mt-1 text-xs text-brand-text/60 font-medium leading-relaxed">
                  Your Cielo Cafe Premium Plan expires in 5 days. Please renew via Settings to avoid interruption.
                </p>
              </div>
            </div>
          </div>
          <div className="flex border-l border-brand-glass-border">
            <button
              onClick={() => toast.dismiss(t.id)}
              className="w-full border border-transparent rounded-none rounded-r-2xl p-4 flex items-center justify-center text-xs uppercase tracking-widest font-bold text-brand-primary hover:bg-brand-primary/10 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      ), { duration: 15000, position: 'top-right' });
    } else if (daysLeft === 1) {
      sessionStorage.setItem(toastKey, '1');
      toast.error('🚨 Critical: Subscription expires tomorrow. Renew to avoid interruption.', { duration: 10000 });
    }
  }, [daysLeft]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (localStorage.getItem('dineovo_terms_accepted') !== 'true') {
      setShowTerms(true);
    }

    Promise.allSettled([
      fetchOrders(),
      fetchRequests(),
      fetchMenuItems(),
      fetchInventory(),
      fetchTables(),
      fetchReservations(),
      fetchAdminProfile(),
      fetchSubscription(),
      // Populates the print/tax settings cache at startup. Previously only the Settings
      // page ever wrote it, so a terminal that had never opened Settings billed at 0% GST.
      loadAppSettings()
    ]).then(() => {
      setIsAppLoading(false);
    });

    // Declared before its call sites below (getSession().then and onAuthStateChange) —
    // both previously referenced this while it was defined further down the effect body.
    // Safe in practice only because those are async callbacks that fire after the effect
    // body finishes running; still the same fragile ordering that caused a real TDZ crash
    // (v1.0.17, `fetchSubscription`) elsewhere in this file.
    //
    // Goes through registerDeviceSession — not a blind upsert — so the 3-device cap is
    // enforced here too. Previously this path (session restored on launch / token refresh)
    // bypassed the cap entirely, since only the interactive Login screen checked it.
    const ensureSessionRegistered = async (session) => {
      try {
        const deviceId = await getDeviceId();
        const { status, evicted } = await registerDeviceSession(session.user.id, deviceId, getDeviceName());
        if (status === 'evicted') {
          toast(`Signed in — freed up the device slot used by "${evicted.device_name || 'an inactive device'}" (inactive the longest).`, { duration: 7000, icon: '🔄' });
        }
      } catch (err) {
        console.error('Failed to register device session:', err);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      sessionRef.current = session;
      setSession(session);
      if (session) ensureSessionRegistered(session);
    });

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (_event === 'SIGNED_OUT') {
        // Report the actual cause rather than inferring it. A null reason means nothing
        // local initiated this sign-out, so the session died on its own — a token refresh
        // that failed (no internet at that moment) or credentials revoked server-side.
        const reason = consumePendingSignOutReason();
        if (reason === SIGN_OUT_REMOTE) {
          toast.error('You have been logged out remotely.', { duration: 5000 });
          markSkipNextAutoLogin();
        } else if (reason === SIGN_OUT_MANUAL) {
          // A human deliberately ended this session — the login screen's remembered
          // credentials must NOT silently re-authenticate them again immediately, or
          // there's no way to ever land on a blank form to switch accounts.
          markSkipNextAutoLogin();
        } else {
          toast.error('Your session ended unexpectedly — please log back in.', { duration: 6000 });
          // No skip here — this is exactly the case the login screen's online-retry
          // should keep auto-recovering from once connectivity returns.
        }
      }
      sessionRef.current = session;
      setSession(session);
      if (session) ensureSessionRegistered(session);
    });

    const adminProfileSubscription = supabase
      .channel('admin_profile_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_profile' }, fetchAdminProfile)
      .subscribe();

    // Live-unlocks the app the moment a renewal is confirmed server-side, no reload needed.
    const subscriptionStatusSubscription = supabase
      .channel('subscription_status_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscription_status' }, fetchSubscription)
      .subscribe();

    const orderSubscription = supabase
      .channel('orders_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async (payload) => {
        if (payload.eventType === 'INSERT') {
          // KDS chime event (for Orders page sound toggle)
          window.dispatchEvent(new CustomEvent('new_data_chime'));
          const notes = payload.new?.notes || '';
          if (notes.toLowerCase().includes('substitution')) {
            toast.error("Substitution Order Received!", { icon: '🔄', duration: 8000 });
          }
          // Universal floating notification (skips KDS automatically)
          pushNotification({
            dedupId: payload.new?.id,
            table_name: payload.new?.table_no || payload.new?.table_name || payload.new?.table_number || 'Takeaway',
            order_type: payload.new?.order_type || 'dine-in',
            item_count: payload.new?.order_items?.length || null,
            isReorder: false,
            batch: 1,
            notifType: 'order',
          });

          // Fetch ONLY this single new order with its line items (~1 KB instead of ~500 KB)
          try {
            const { data: newOrder } = await supabase
              .from('orders')
              .select(ORDER_COLUMNS)
              .eq('id', payload.new.id)
              .maybeSingle();

            if (newOrder) {
              logSupabaseRead('orders', 'single INSERT row fetch', newOrder);
              setOrders(prev => {
                if (prev.some(o => o.id === newOrder.id)) {
                  return prev.map(o => o.id === newOrder.id ? newOrder : o);
                }
                return [newOrder, ...prev];
              });
              return;
            }
          } catch (err) {
            console.error('Error fetching single order, falling back to debounced sync:', err);
          }
          fetchOrdersDebounced();

        } else if (payload.eventType === 'UPDATE') {
          if (payload.new?.status === 'cancelled') {
            window.dispatchEvent(new CustomEvent('new_data_chime'));
            const shortId = payload.new.order_number != null
              ? `#${payload.new.order_number}`
              : `#${String(payload.new.id).slice(0, 6).toUpperCase()}`;
            toast.error(`Order ${shortId} (${payload.new.table_no ? 'Table ' + payload.new.table_no : 'Takeaway'}) was cancelled by guest!`, {
              icon: '🚫',
              duration: 8000
            });
          }
          // Patch updated row into state directly without refetching tables (0 egress)
          if (payload.new) {
            setOrders(prev => patchOrderUpdate(prev, payload.new));
          }

        } else if (payload.eventType === 'DELETE') {
          // Remove deleted order from state directly (0 egress)
          if (payload.old?.id) {
            setOrders(prev => prev.filter(o => o.id !== payload.old.id));
          }
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_items' }, (payload) => {
        if (payload.new?.batch > 1) {
           window.dispatchEvent(new CustomEvent('new_data_chime'));
           toast.success(`Table reordered! New items merged (Round ${payload.new.batch})`, { icon: '🔄', duration: 6000 });
           // Universal floating notification (skips KDS automatically)
           pushNotification({
             dedupId: payload.new?.order_id || payload.new?.id,
             table_name: null,
             order_type: 'dine-in',
             item_count: null,
             isReorder: true,
             batch: payload.new?.batch || 1,
             notifType: 'order',
           });
        }
        // Patch new item into the parent order in state directly (0 egress)
        if (payload.new) {
          setOrders(prev => patchOrderItem(prev, payload.new, 'INSERT'));
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'order_items' }, (payload) => {
        // Patch updated item (e.g. prepared toggle) in state directly (0 egress)
        if (payload.new) {
          setOrders(prev => patchOrderItem(prev, payload.new, 'UPDATE'));
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'order_items' }, (payload) => {
        // Remove deleted item from order in state directly (0 egress)
        if (payload.old) {
          setOrders(prev => patchOrderItem(prev, payload.old, 'DELETE'));
        }
      })
      .subscribe();

    const menuSubscription = supabase
      .channel('menu_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, (payload) => {
        if (payload.eventType === 'INSERT' && payload.new) {
          setMenuItems(prev => [...prev.filter(m => m.id !== payload.new.id), payload.new].sort((a,b) => a.name.localeCompare(b.name)));
        } else if (payload.eventType === 'UPDATE' && payload.new) {
          setMenuItems(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m));
        } else if (payload.eventType === 'DELETE' && payload.old) {
          setMenuItems(prev => prev.filter(m => m.id !== payload.old.id));
        }
      })
      .subscribe();

    const requestSubscription = supabase
      .channel('requests_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, (payload) => {
        if (payload.eventType === 'INSERT' && payload.new) {
          window.dispatchEvent(new CustomEvent('new_data_chime'));
          // Universal floating notification for customer requests
          const reqType = payload.new.type || 'request';
          const requestLabels = {
            waiter: 'Waiter Requested',
            clean: 'Table Cleaning Request',
            bill: 'Bill Requested',
          };
          // Water requests have format 'water_N'
          const isWater = reqType.startsWith('water');
          const isReview = reqType.toLowerCase().startsWith('review');
          pushNotification({
            dedupId: payload.new.id,
            table_name: payload.new.table_no || null,
            order_type: 'request',
            item_count: null,
            isReorder: false,
            batch: 1,
            notifType: 'request',
            requestType: reqType,
            requestLabel: isWater
              ? `Water Order (x${reqType.split('_')[1] || 1})`
              : isReview
              ? 'Customer Review Received'
              : (requestLabels[reqType] || 'Customer Request'),
          });
          setRequests(prev => [payload.new, ...prev.filter(r => r.id !== payload.new.id)]);
        } else if (payload.eventType === 'UPDATE' && payload.new) {
          setRequests(prev => prev.map(r => r.id === payload.new.id ? { ...r, ...payload.new } : r));
        } else if (payload.eventType === 'DELETE' && payload.old) {
          setRequests(prev => prev.filter(r => r.id !== payload.old.id));
        }
      })
      .subscribe();

    const inventorySubscription = supabase
      .channel('inventory_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, (payload) => {
        const lowStockAlertsEnabled = localStorage.getItem('dineovo_low_stock_alerts') !== 'false';
        if (payload.eventType === 'UPDATE' && lowStockAlertsEnabled && payload.new) {
          const item = payload.new;
          const prevItem = prevInventoryRef.current?.find(i => i.id === item.id);
          if (prevItem) {
            if (prevItem.quantity > prevItem.min_stock && item.quantity <= item.min_stock && item.quantity > 0) {
              toast(`Low Stock Alert: ${item.name} is running low!`, { icon: '⚠️', style: { color: '#eab308' } });
            } else if (prevItem.quantity > 0 && item.quantity <= 0) {
              toast.error(`Out of Stock: ${item.name} is completely out of stock!`);
            }
          }
        }
        if (payload.eventType === 'INSERT' && payload.new) {
          setInventory(prev => {
            const next = [...prev.filter(i => i.id !== payload.new.id), payload.new].sort((a,b) => a.name.localeCompare(b.name));
            prevInventoryRef.current = next;
            return next;
          });
        } else if (payload.eventType === 'UPDATE' && payload.new) {
          setInventory(prev => {
            const next = prev.map(i => i.id === payload.new.id ? { ...i, ...payload.new } : i);
            prevInventoryRef.current = next;
            return next;
          });
        } else if (payload.eventType === 'DELETE' && payload.old) {
          setInventory(prev => {
            const next = prev.filter(i => i.id !== payload.old.id);
            prevInventoryRef.current = next;
            return next;
          });
        }
      })
      .subscribe();

    const tablesSubscription = supabase
      .channel('tables_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, (payload) => {
        if (payload.eventType === 'INSERT' && payload.new) {
          setTables(prev => [...prev.filter(t => t.id !== payload.new.id), payload.new]);
        } else if (payload.eventType === 'UPDATE' && payload.new) {
          setTables(prev => prev.map(t => t.id === payload.new.id ? { ...t, ...payload.new } : t));
        } else if (payload.eventType === 'DELETE' && payload.old) {
          setTables(prev => prev.filter(t => t.id !== payload.old.id));
        }
      })
      .subscribe();

    const reservationsSubscription = supabase
      .channel('app_reservations_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, (payload) => {
        if (payload.eventType === 'INSERT' && payload.new) {
          setReservations(prev => [...prev.filter(r => r.id !== payload.new.id), payload.new]);
        } else if (payload.eventType === 'UPDATE' && payload.new) {
          setReservations(prev => prev.map(r => r.id === payload.new.id ? { ...r, ...payload.new } : r));
        } else if (payload.eventType === 'DELETE' && payload.old) {
          setReservations(prev => prev.filter(r => r.id !== payload.old.id));
        }
      })
      .subscribe();

    // ─── Session Security: Realtime force-logout listener ───
    // deviceId now resolves asynchronously (an IPC round-trip in Electron — see
    // lib/session.js), so it's captured in this closure once resolved rather than read
    // synchronously from localStorage up front. The previous synchronous read meant that
    // on a genuinely fresh install (no localStorage value written yet), deviceId was null
    // at this exact line and the `if (deviceId)` guard skipped creating this listener for
    // the entire session — silently disabling remote force-logout detection until the next
    // relaunch. The channel now always subscribes; only the payload comparison waits on
    // deviceId being resolved.
    let deviceId = null;
    getDeviceId().then(id => { deviceId = id; });

    const sessionSubscription = supabase
      .channel('session_security_channel')
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'active_sessions' }, (payload) => {
        if (!deviceId || !payload.old || payload.old.device_id !== deviceId) return;
        // Our own logout deletes this row too, and Realtime echoes that DELETE straight
        // back to us — which used to make a deliberate logout announce itself as a remote
        // one. Ignore the echo of a sign-out we started, and any that lands after we're
        // already signed out. The toast is raised by the auth listener, not here, so it
        // fires exactly once when SIGNED_OUT actually arrives.
        if (isSignOutPending() || !sessionRef.current) return;
        signOutWithReason(SIGN_OUT_REMOTE);
      })
      .subscribe();

    // ─── Session Heartbeat: Update last_active every 2 minutes ───
    // Also the data the 5-device cap's auto-eviction (registerDeviceSession) uses to pick
    // the stalest session — previously written but never read by anything.
    const heartbeatInterval = setInterval(async () => {
      if (deviceId) {
        await supabase
          .from('active_sessions')
          .update({ last_active: new Date().toISOString() })
          .eq('device_id', deviceId);
      }
    }, 120000);

    // Poll local SQLite server for offline orders every 5 seconds (zero Supabase cloud egress).
    // Skips when tab is hidden.
    const localPollInterval = setInterval(() => {
      if (!document.hidden) fetchLocalOrders();
    }, 5000);

    // Cloud resync when window regains focus after being hidden > 5 minutes
    const handleVisibilityChange = () => {
      if (!document.hidden && Date.now() - lastSupabaseSyncRef.current > 300000) {
        fetchOrders();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cloud resync when network connectivity returns
    const handleOnline = () => {
      fetchOrders();
    };
    window.addEventListener('online', handleOnline);

    return () => {
      clearTimeout(fetchOrdersDebounceRef.current);
      clearInterval(localPollInterval);
      clearInterval(heartbeatInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      supabase.removeChannel(orderSubscription);
      supabase.removeChannel(menuSubscription);
      supabase.removeChannel(requestSubscription);
      supabase.removeChannel(inventorySubscription);
      supabase.removeChannel(tablesSubscription);
      supabase.removeChannel(reservationsSubscription);
      supabase.removeChannel(adminProfileSubscription);
      supabase.removeChannel(subscriptionStatusSubscription);
      supabase.removeChannel(sessionSubscription);
      authSubscription.unsubscribe();
    };
  }, []);

  // Auto Updater — only show notification AFTER user is logged in.
  // Depends on `!!session`, not `session` itself: Supabase hands out a new session object
  // on every token refresh (~hourly) even though the user never logged out, and using the
  // object directly re-ran this whole effect on each refresh — re-registering IPC listeners
  // without ever removing the old ones (accumulating duplicates) and re-showing the toast.
  const isLoggedIn = !!session;
  useEffect(() => {
    if (!isLoggedIn) return;
    if (!window.electronAPI) return;

    const removeAvailable = window.electronAPI.onUpdateAvailable((info) => {
      // Only notify once per available version — a later re-check (app restart, etc.)
      // finding the same not-yet-installed version shouldn't nag again.
      const notifiedVersion = localStorage.getItem('dineovo_update_notified_version');
      if (notifiedVersion === info.version) return;
      localStorage.setItem('dineovo_update_notified_version', info.version);

      toast.custom((t) => (
        <div className="max-w-md w-full bg-brand-card shadow-2xl rounded-2xl pointer-events-auto flex ring-1 ring-brand-primary/50 overflow-hidden relative border border-brand-primary/20">
          <div className="absolute inset-0 bg-linear-to-r from-brand-primary/5 to-transparent"></div>
          <div className="flex-1 w-0 p-4 relative z-10">
            <div className="flex items-start">
              <div className="ml-2 flex-1">
                <p className="text-sm font-black text-brand-text flex items-center gap-2">
                  <RefreshCw size={16} className="text-brand-primary animate-spin-slow" />
                  Update Available
                </p>
                <p className="mt-1 text-xs text-brand-text/60 font-medium">
                  A new version of Cielo Cafe is ready.
                </p>
              </div>
            </div>
          </div>
          <div className="flex border-l border-brand-glass-border relative z-10">
            <button
              onClick={() => {
                toast.dismiss(t.id);
                setIsUpdating(true);
                window.electronAPI.startDownload();
              }}
              className="w-full border border-transparent rounded-none rounded-r-2xl px-6 py-4 flex items-center justify-center text-xs font-black text-brand-primary hover:bg-brand-primary hover:text-white transition-all tracking-wider uppercase"
            >
              Download
            </button>
          </div>
        </div>
      ), { duration: Infinity, position: 'top-right' });
    });

    const removeProgress = window.electronAPI.onUpdateProgress((progressObj) => {
      setUpdateProgress(progressObj.percent);
    });

    const removeDownloaded = window.electronAPI.onUpdateDownloaded(() => {
      setUpdateProgress(100);
      setUpdateMessage('Ready! Restarting...');
      setTimeout(() => {
        window.electronAPI.installUpdate();
      }, 2000);
    });

    // Without this, a failed download (no internet, missing GitHub release asset, etc.)
    // left the full-screen update overlay frozen at 0% forever with no way out.
    const removeError = window.electronAPI.onUpdateError((message) => {
      setIsUpdating(false);
      setUpdateProgress(0);
      toast.error('Update failed: ' + (message || 'Unknown error') + '. Please try again later.', { duration: 8000 });
    });

    // Start checking for updates now that listeners are registered
    window.electronAPI.checkForUpdates();

    return () => {
      // Remove only this effect's own listeners — Settings' Updates tab registers its own
      // independently and must not be torn down by this one unmounting/re-running.
      removeAvailable?.();
      removeProgress?.();
      removeDownloaded?.();
      removeError?.();
    };
  }, [isLoggedIn]);


  // Explicit column list for orders & order_items to avoid downloading unused metadata.
  const ORDER_COLUMNS = 'id, table_no, customer_name, mobile_no, status, notes, payment_method, paid_cash, paid_upi, paid_card, discount_type, discount_value, discount_amount, taxable_value, cgst_amount, sgst_amount, round_off, grand_total, order_number, invoice_number, created_at, inventory_deducted, order_items(id, order_id, item_id, quantity, custom_name, price, status, batch, created_at, prepared)';

  const lastSupabaseSyncRef = useRef(Date.now());

  // 1. Fetch from Local Express/SQLite server ONLY (Free, 0 Supabase cloud egress)
  const fetchLocalOrders = useCallback(async () => {
    if (!window.LOCAL_API_KEY) return;
    const host = window.location.hostname || 'localhost';
    try {
      const res = await fetch(`http://${host}:3000/api/orders`, {
        headers: { 'x-api-key': window.LOCAL_API_KEY }
      });
      if (!res.ok) return;
      const localOrders = await res.json();
      if (Array.isArray(localOrders) && localOrders.length > 0) {
        setOrders(prevOrders => mergeLocalAndCloudOrders(prevOrders, localOrders));
      }
    } catch {
      // Local server down or offline, silent fail
    }
  }, []);

  // 2. Full Cloud Resync (Runs on startup, user login, reconnect, or focus after idle >5m)
  const fetchOrders = useCallback(async () => {
    // Check local server first for instant offline order availability
    await fetchLocalOrders();

    const sevenDaysAgo = subDays(new Date(), 7).toISOString();
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(ORDER_COLUMNS)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .order('created_at', { referencedTable: 'order_items', ascending: true })
        .order('id', { referencedTable: 'order_items', ascending: true });

      if (!error && data) {
        logSupabaseRead('orders', 'fetchOrders (7d cloud sync)', data);
        lastSupabaseSyncRef.current = Date.now();
        // Merge so any local-only offline orders aren't overwritten
        setOrders(prev => {
          const unsyncedLocal = prev.filter(p => p.synced === 0);
          if (unsyncedLocal.length > 0) {
            return mergeLocalAndCloudOrders(data, unsyncedLocal);
          }
          return data;
        });
      }
    } catch {
      console.log('Offline: Could not reach Supabase');
    }
  }, [fetchLocalOrders]);

  // Fallback debounced refetch: debounced to 2500ms to avoid burst requests
  const fetchOrdersDebounceRef = useRef(null);
  const fetchOrdersDebounced = useCallback(() => {
    clearTimeout(fetchOrdersDebounceRef.current);
    fetchOrdersDebounceRef.current = setTimeout(fetchOrders, 2500);
  }, [fetchOrders]);

  const fetchRequests = useCallback(async () => {
    const sevenDaysAgo = subDays(new Date(), 7).toISOString();
    const { data, error } = await supabase
      .from('requests')
      .select('id, type, table_no, status, created_at')
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false });
    if (!error && data) {
      logSupabaseRead('requests', 'fetchRequests', data);
      setRequests(data);
    }
  }, []);

  const fetchMenuItems = useCallback(async () => {
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, name, price, category, status, is_veg, description')
      .order('name');
    if (!error && data) {
      logSupabaseRead('menu_items', 'fetchMenuItems', data);
      setMenuItems(data);
    }
  }, []);

  const fetchInventory = useCallback(async () => {
    const { data, error } = await supabase
      .from('inventory')
      .select('id, name, category, quantity, unit, min_stock, cost_price, selling_price, supplier')
      .order('name');
    if (!error && data) {
      logSupabaseRead('inventory', 'fetchInventory', data);
      const lowStockAlertsEnabled = localStorage.getItem('dineovo_low_stock_alerts') !== 'false';
      if (prevInventoryRef.current && lowStockAlertsEnabled) {
        data.forEach(item => {
          const prevItem = prevInventoryRef.current.find(i => i.id === item.id);
          if (prevItem) {
            if (prevItem.quantity > prevItem.min_stock && item.quantity <= item.min_stock && item.quantity > 0) {
              toast(`Low Stock Alert: ${item.name} is running low!`, { icon: '⚠️', style: { color: '#eab308' } });
            } else if (prevItem.quantity > 0 && item.quantity <= 0) {
              toast.error(`Out of Stock: ${item.name} is completely out of stock!`);
            }
          }
        });
      }
      prevInventoryRef.current = data;
      setInventory(data);
    }
  }, []);

  const fetchTables = useCallback(async () => {
    const { data, error } = await supabase.from('tables').select('id, table_no, capacity, status, floor, qr_code');
    if (!error && data) {
      logSupabaseRead('tables', 'fetchTables', data);
      setTables(data);
    }
  }, []);

  const fetchReservations = useCallback(async () => {
    const { data, error } = await supabase.from('reservations').select('id, customer_name, phone, guest_count, reservation_date, reservation_time, table_no, status, notes');
    if (!error && data) {
      logSupabaseRead('reservations', 'fetchReservations', data);
      setReservations(data);
    }
  }, []);

  const fetchAdminProfile = useCallback(async () => {
    const { data, error } = await supabase.from('admin_profile').select('id, name, avatar_url, updated_at').eq('id', 1).maybeSingle();
    if (!error && data) {
      logSupabaseRead('admin_profile', 'fetchAdminProfile', data);
      setAdminProfile(data);
    }
  }, []);

  const fetchSubscription = useCallback(async () => {
    const { data, error } = await supabase.from('subscription_status').select('expiry_date').eq('id', 1).maybeSingle();
    if (!error && data) {
      logSupabaseRead('subscription_status', 'fetchSubscription', data);
      setExpiryDate(data.expiry_date);
    }
  }, []);

  // The mount effect (way above) only runs once per app launch, not on every login/logout
  // (logging out doesn't unmount App — it just swaps which screen renders). Subscription
  // status needs to be current for whoever's actually logged in right now, so re-fetch it
  // on every fresh login instead of relying solely on the one-time initial fetch.
  useEffect(() => {
    if (session) fetchSubscription();
  }, [session, fetchSubscription]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  if (showTerms) {
    return <TermsModal onAccept={() => setShowTerms(false)} />;
  }

  if (!session) {
    return (
      <React.Fragment>
        <Toaster position="top-center" />
        <Login />
      </React.Fragment>
    );
  }

  if (daysLeft <= 0) {
    return <LockoutScreen />;
  }

  return (
    <HashRouter>
      <Toaster 
        position="top-center" 
        toastOptions={{
          style: {
            background: 'var(--card-bg)',
            color: 'var(--text-color)',
            border: '1px solid var(--glass-border)',
            borderRadius: '16px',
            fontSize: '14px',
            fontWeight: '600'
          }
        }} 
      />
      <div className="flex h-screen bg-brand-bg text-brand-text overflow-hidden font-sans transition-colors duration-300">
        {/* Left Sidebar */}
        <Sidebar toggleTheme={toggleTheme} theme={theme} isMobileMenuOpen={isMobileMenuOpen} setIsMobileMenuOpen={setIsMobileMenuOpen} adminProfile={adminProfile} onOpenProfile={() => setIsProfileModalOpen(true)} inventory={inventory} />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col h-screen overflow-hidden bg-brand-bg relative w-full md:ml-20">
          
          {/* Mobile Top Bar */}
          <div className="md:hidden flex items-center justify-between p-4 border-b border-brand-glass-border bg-brand-card shrink-0">
            <div className="flex items-center gap-2">
              <img src="./logo.png" alt="Logo" className="w-8 h-8 rounded-lg bg-white object-contain" />
              <h1 className="font-black text-brand-text text-lg">CIELO CAFE</h1>
            </div>
            <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 rounded-xl bg-brand-secondary/50 text-brand-text">
              <Menu size={20} />
            </button>
          </div>

          <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 relative w-full">
            <AnimatedAppRoutes
              orders={orders}
              requests={requests}
              menuItems={menuItems}
              inventory={inventory}
              tables={tables}
              reservations={reservations}
              fetchOrders={fetchOrders}
              fetchRequests={fetchRequests}
              onAddOrder={() => setIsAddOrderOpen(true)}
              isLoading={isAppLoading}
              fetchMenuItems={fetchMenuItems}
              fetchTables={fetchTables}
              daysLeft={daysLeft}
              expiryDate={expiryDate}
            />
          </main>
        </div>

        {isAddOrderOpen && (
          <OrderModal 
            menuItems={menuItems} 
            tables={tables}
            onClose={() => setIsAddOrderOpen(false)} 
            onSave={() => {
              setIsAddOrderOpen(false);
              fetchOrders();
            }} 
          />
        )}
        
        {isProfileModalOpen && (
          <ProfileModal 
            profile={adminProfile}
            onClose={() => setIsProfileModalOpen(false)}
            onSave={() => {
              setIsProfileModalOpen(false);
              fetchAdminProfile();
            }}
          />
        )}
        
        {isUpdating && (
          <UpdaterOverlay progress={updateProgress} message={updateMessage} />
        )}

        {/* Universal New Order Notification — renders on every page except KDS */}
        <NewOrderNotificationGate
          notifications={orderNotifications}
          onDismiss={dismissNotification}
          onDismissAll={dismissAllNotifications}
        />
      </div>
    </HashRouter>
  );
}

// Gate component that hides new-order notifications when on the KDS page
function NewOrderNotificationGate({ notifications, onDismiss, onDismissAll }) {
  const location = useLocation();
  const isKDS = location.pathname === '/';

  // Auto-clear notifications when navigating TO KDS
  useEffect(() => {
    if (isKDS && notifications.length > 0) onDismissAll();
  }, [isKDS]);

  if (isKDS) return null;

  return (
    <NewOrderNotification
      notifications={notifications}
      onDismiss={onDismiss}
      onDismissAll={onDismissAll}
    />
  );
}

const NavItem = ({ to, icon: Icon, label, isActive, isCollapsed, onClick }) => {
  return (
    <Link 
      to={to} 
      onClick={onClick}
      title={isCollapsed ? label : undefined}
      className={`flex items-center py-2.5 rounded-xl text-sm font-medium transition-all mb-1 no-underline overflow-hidden whitespace-nowrap ${
        isActive 
          ? 'bg-brand-primary/10 text-brand-primary' 
          : 'text-brand-text/60 hover:bg-brand-secondary/30 hover:text-brand-text'
      }`}
    >
      <div className="w-12 flex justify-center shrink-0">
        <Icon size={20} className={isActive ? 'text-brand-primary' : 'text-brand-text/50'} />
      </div>
      <AnimatePresence>
        {!isCollapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            className="whitespace-nowrap pl-1"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
};

const NavCategory = ({ title, isCollapsed }) => (
  <div className="text-[10px] font-bold text-brand-text/40 tracking-widest uppercase mt-6 mb-2 h-4 flex items-center overflow-hidden whitespace-nowrap">
    <AnimatePresence mode="wait">
      {isCollapsed ? (
        <motion.div key="line" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-12 flex justify-center shrink-0">
          <div className="w-4 h-px bg-brand-text/20"></div>
        </motion.div>
      ) : (
        <motion.div key="title" initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }} className="pl-4">
          {title}
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

function Sidebar({ toggleTheme, theme, isMobileMenuOpen, setIsMobileMenuOpen, adminProfile, onOpenProfile }) {
  const [isHovered, setIsHovered] = useState(false);
  const location = useLocation();
  const currentPath = location.pathname;
  
  const isExpanded = isHovered || isMobileMenuOpen;
  
  const adminName = adminProfile?.name || 'Admin Profile';
  const adminInitial = adminName.charAt(0).toUpperCase();
  const adminAvatar = adminProfile?.avatar_url;

  return (
    <>
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          />
        )}
      </AnimatePresence>

      <motion.aside 
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        initial={false}
        animate={{ 
          width: isExpanded ? 240 : 80,
          x: isMobileMenuOpen ? 0 : (window.innerWidth < 768 ? '-100%' : 0)
        }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className={`bg-brand-card border-r border-brand-glass-border flex flex-col h-full shrink-0 transition-colors duration-300 z-50
          fixed top-0 left-0 bottom-0
          ${isExpanded ? 'shadow-2xl' : 'shadow-none'}
        `}
      >
      {/* Brand / Logo Area */}
      <div className="pt-6 pb-2 px-4 overflow-hidden flex flex-col">
        <div className="flex items-center w-full mb-6">
          <div className="w-12 flex justify-center shrink-0">
            <img src="./logo.png" alt="Dineovo Logo" className="w-10 h-10 object-contain rounded-xl bg-white shadow-lg shrink-0" />
          </div>
          <AnimatePresence>
            {isExpanded && (
              <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }} className="overflow-hidden whitespace-nowrap">
                <div className="pl-3">
                  <h2 className="text-lg font-black text-brand-text leading-none tracking-tight">CIELO CAFE</h2>
                  <p className="text-[10px] font-medium text-brand-text/50 uppercase tracking-widest mt-1">Cafe Manager v1.0.8</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-4 no-scrollbar pb-6 overflow-x-hidden">
        <NavCategory title="Main" isCollapsed={!isExpanded} />
        <NavItem to="/" icon={LayoutDashboard} label="KDS" isActive={currentPath === '/'} isCollapsed={!isExpanded} onClick={() => setIsMobileMenuOpen(false)} />
        <NavItem to="/dashboard" icon={BarChart2} label="Dashboard" isActive={currentPath === '/dashboard'} isCollapsed={!isExpanded} onClick={() => setIsMobileMenuOpen(false)} />
        
        <NavCategory title="Finance" isCollapsed={!isExpanded} />
        <NavItem to="/expenses" icon={Receipt} label="Expenses" isActive={currentPath === '/expenses'} isCollapsed={!isExpanded} onClick={() => setIsMobileMenuOpen(false)} />
        <NavItem to="/revenue" icon={TrendingUp} label="Revenue" isActive={currentPath === '/revenue'} isCollapsed={!isExpanded} onClick={() => setIsMobileMenuOpen(false)} />
        
        <NavCategory title="Operations" isCollapsed={!isExpanded} />
        <NavItem to="/inventory" icon={Package} label="Inventory" isActive={currentPath === '/inventory'} isCollapsed={!isExpanded} onClick={() => setIsMobileMenuOpen(false)} />
        <NavItem to="/recipes" icon={ChefHat} label="Recipes & Usage" isActive={currentPath === '/recipes'} isCollapsed={!isExpanded} onClick={() => setIsMobileMenuOpen(false)} />
        <NavItem to="/reservations" icon={Calendar} label="Reservations" isActive={currentPath === '/reservations'} isCollapsed={!isExpanded} onClick={() => setIsMobileMenuOpen(false)} />

        <NavCategory title="CRM & HR" isCollapsed={!isExpanded} />
        <NavItem to="/customers" icon={Star} label="Loyalty & CRM" isActive={currentPath === '/customers'} isCollapsed={!isExpanded} onClick={() => setIsMobileMenuOpen(false)} />
        <NavItem to="/employees" icon={Users} label="Employees" isActive={currentPath === '/employees'} isCollapsed={!isExpanded} onClick={() => setIsMobileMenuOpen(false)} />
        <NavItem to="/salaries" icon={CreditCard} label="Salaries" isActive={currentPath === '/salaries'} isCollapsed={!isExpanded} onClick={() => setIsMobileMenuOpen(false)} />
        <NavItem to="/vendors" icon={Store} label="Vendors" isActive={currentPath === '/vendors'} isCollapsed={!isExpanded} onClick={() => setIsMobileMenuOpen(false)} />
        <NavItem to="/menu" icon={Menu} label="Menu" isActive={currentPath === '/menu'} isCollapsed={!isExpanded} onClick={() => setIsMobileMenuOpen(false)} />
        
        <NavCategory title="Reports" isCollapsed={!isExpanded} />
        <NavItem to="/reports" icon={FileText} label="Reports" isActive={currentPath === '/reports'} isCollapsed={!isExpanded} onClick={() => setIsMobileMenuOpen(false)} />
        <NavItem to="/analytics" icon={BarChart2} label="Analytics" isActive={currentPath === '/analytics'} isCollapsed={!isExpanded} onClick={() => setIsMobileMenuOpen(false)} />
        
        <NavCategory title="System" isCollapsed={!isExpanded} />
        <NavItem to="/settings" icon={SettingsIcon} label="Settings" isActive={currentPath === '/settings'} isCollapsed={!isExpanded} onClick={() => setIsMobileMenuOpen(false)} />
      </div>

      {/* Footer / User Area */}
      <div className="p-4 border-t border-brand-glass-border flex flex-col gap-2 overflow-hidden whitespace-nowrap transition-all">
        <div className="flex items-center py-2 rounded-xl transition-colors cursor-pointer hover:bg-brand-secondary/30" onClick={onOpenProfile}>
           <div className="w-12 flex justify-center shrink-0">
             {adminAvatar ? (
               <img src={adminAvatar} alt="Avatar" className="w-8 h-8 rounded-full object-cover border border-brand-glass-border" />
             ) : (
               <div className="w-8 h-8 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center font-bold text-xs">{adminInitial}</div>
             )}
           </div>
           <AnimatePresence>
             {isExpanded && (
               <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }}>
                 <div className="text-sm font-medium text-brand-text whitespace-nowrap pl-1 truncate">{adminName}</div>
               </motion.div>
             )}
           </AnimatePresence>
        </div>
        <button onClick={toggleTheme} className="flex items-center py-2 rounded-xl text-brand-text/60 hover:text-brand-text hover:bg-brand-secondary/30 transition-colors">
          <div className="w-12 flex justify-center shrink-0">
            {theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
          </div>
          <AnimatePresence>
             {isExpanded && (
               <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }}>
                 <div className="text-sm font-medium whitespace-nowrap text-left pl-1">
                   {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                 </div>
               </motion.div>
             )}
           </AnimatePresence>
        </button>
        <button onClick={async () => {
          // Marked before the delete (not after signOut) because that delete is what
          // triggers the Realtime DELETE this same client also listens for — the echo
          // must see isSignOutPending() already true or it'll mistake this for a remote
          // force-logout.
          markSignOutReason(SIGN_OUT_MANUAL);
          try {
            const deviceId = await getDeviceId();
            await supabase.from('active_sessions').delete().eq('device_id', deviceId);
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
          } catch (err) {
            consumePendingSignOutReason(); // don't mislabel a later, unrelated sign-out
            toast.error('Failed to log out: ' + err.message);
          }
        }} className="flex items-center py-2 rounded-xl text-brand-text/60 hover:text-red-500 hover:bg-red-500/10 transition-colors">
          <div className="w-12 flex justify-center shrink-0">
            <LogOut size={20} />
          </div>
          <AnimatePresence>
             {isExpanded && (
               <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }}>
                 <div className="text-sm font-medium whitespace-nowrap text-left pl-1">
                   Logout
                 </div>
               </motion.div>
             )}
           </AnimatePresence>
        </button>
      </div>
    </motion.aside>
    </>
  );
}

function LockoutScreen() {
  // Settings (where the renewal QR code normally lives) is unreachable once locked
  // out, so the payment step is embedded here. Renewal is now verified and applied
  // server-side (see database_scripts/supabase_subscription_setup.sql) — this screen
  // unlocks live via Realtime the moment that happens, no self-service bypass.
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-black/95 text-center p-6 relative z-9999 w-full overflow-y-auto">
      <div className="bg-brand-card p-10 rounded-3xl border border-red-500/30 max-w-lg w-full shadow-2xl shadow-red-500/10 my-6">
        <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertTriangle size={36} className="text-red-500" />
        </div>
        <h1 className="text-3xl font-black text-brand-text mb-3">Subscription Expired</h1>
        <p className="text-brand-text/60 mb-8 leading-relaxed font-medium">
          Your software license for Cielo Cafe has expired. Access to the POS, KDS, and management dashboard is temporarily locked until the subscription is renewed.
        </p>

        <div className="w-40 h-40 bg-white p-2 rounded-2xl mb-6 shadow-xl shadow-brand-primary/10 mx-auto">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=upi://pay?pa=cielocafe@upi&pn=CieloCafe&am=6500.00&cu=INR" alt="QR Code" className="w-full h-full object-cover rounded-xl" />
        </div>
        <p className="text-brand-text/50 font-medium mb-6">Pay ₹6,500 to renew your Premium Plan for 1 year via any UPI app.</p>

        <button
          onClick={() => toast.success("Thanks! We'll confirm your payment and unlock your account shortly.", { duration: 6000 })}
          className="w-full py-4 bg-brand-primary text-white font-bold rounded-xl text-lg hover:bg-brand-primary/90 transition-all shadow-lg shadow-brand-primary/20"
        >
          I have made the payment
        </button>
      </div>
    </div>
  );
}



function ProfileModal({ profile, onClose, onSave }) {
  const [name, setName] = useState(profile?.name || 'Admin Profile');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');
  const [role, setRole] = useState(profile?.role || 'Manager');
  const [email, setEmail] = useState(profile?.email || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileUpload = async (event) => {
    try {
      if (!event.target.files || event.target.files.length === 0) {
        return;
      }
      const file = event.target.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `avatar-${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;

      setIsUploading(true);

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file);

      if (uploadError) {
        throw uploadError;
      }

      const { data } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      setAvatarUrl(data.publicUrl);
      toast.success('Image uploaded successfully!');
    } catch (error) {
      toast.error('Error uploading image: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    
    try {
      const { error } = await supabase
        .from('admin_profile')
        .upsert({ id: 1, name, avatar_url: avatarUrl, role, email, phone });
        
      if (error) throw error;
      toast.success('Profile updated successfully!');
      onSave();
    } catch (err) {
      toast.error('Failed to update profile: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></motion.div>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-brand-card rounded-3xl shadow-xl w-[95%] sm:w-full max-w-md flex flex-col overflow-hidden z-10 relative">
        <div className="flex justify-between items-center p-5 border-b border-brand-glass-border">
          <h2 className="text-xl font-bold text-brand-text">Admin Profile</h2>
          <button className="p-2 rounded-xl bg-brand-secondary/50 hover:bg-brand-secondary text-brand-text/70 transition-colors" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        
        <form onSubmit={handleSave} className="p-5 flex flex-col gap-4">
          <div className="flex flex-col gap-4 items-center mb-2">
            <div 
              className="w-24 h-24 rounded-full bg-brand-primary/20 border-2 border-brand-primary flex items-center justify-center overflow-hidden shrink-0 shadow-lg relative group cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
              ) : (
                <span className="text-brand-primary text-3xl font-black group-hover:opacity-50 transition-opacity">{name.charAt(0).toUpperCase()}</span>
              )}
              <div className="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-sm">
                <UploadCloud size={24} className="text-white mb-1" />
                <span className="text-[10px] text-white font-bold uppercase tracking-wider text-center">{isUploading ? 'Uploading...' : 'Upload'}</span>
              </div>
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept="image/*" 
              className="hidden" 
              disabled={isUploading}
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-[11px] font-bold text-brand-text/50 uppercase tracking-widest mb-1 block">Full Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} required className="w-full bg-brand-secondary/30 border border-brand-glass-border rounded-xl px-4 py-2.5 text-brand-text text-sm focus:outline-none focus:border-brand-primary/50 transition-colors" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-[11px] font-bold text-brand-text/50 uppercase tracking-widest mb-1 block">Role / Title</label>
              <input type="text" value={role} onChange={e => setRole(e.target.value)} className="w-full bg-brand-secondary/30 border border-brand-glass-border rounded-xl px-4 py-2.5 text-brand-text text-sm focus:outline-none focus:border-brand-primary/50 transition-colors" />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold text-brand-text/50 uppercase tracking-widest mb-1 block">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-brand-secondary/30 border border-brand-glass-border rounded-xl px-4 py-2.5 text-brand-text text-sm focus:outline-none focus:border-brand-primary/50 transition-colors" />
          </div>

          <div>
            <label className="text-[11px] font-bold text-brand-text/50 uppercase tracking-widest mb-1 block">Phone</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="w-full bg-brand-secondary/30 border border-brand-glass-border rounded-xl px-4 py-2.5 text-brand-text text-sm focus:outline-none focus:border-brand-primary/50 transition-colors" />
          </div>

          <div className="flex gap-3 pt-4 mt-2 border-t border-brand-glass-border">
            <button type="button" className="flex-1 py-3 text-brand-text font-bold bg-brand-secondary/30 border border-brand-glass-border rounded-xl hover:bg-brand-secondary transition-colors" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="flex-1 py-3 text-white font-bold bg-brand-primary rounded-xl hover:bg-blue-700 transition-colors shadow-md disabled:opacity-50">
              {isSaving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

export default App;
