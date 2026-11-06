import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { computeOrderTotals } from '../lib/orderTotals';
import { businessDayOf, todayBusinessDay, addDays, businessDayRangeUtc, presetRange } from '../lib/businessDay';
import Calendar from '../components/Calendar';
import { getTaxRatePercent, readCache } from '../lib/appSettings';
import { useGreeting } from '../lib/useGreeting';
import { billRow } from '../lib/dayReport';
import { Filter, CheckCircle, Clock, List, RefreshCw, X, Trash2, Plus, Check, Settings, Receipt, BarChart2, MessageCircle, Printer, Ban, Volume2, VolumeX, AlertTriangle, Star, GitMerge, Bell, Package, ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import Skeleton from '../components/Skeleton';
import CategorySelect from '../components/CategorySelect';

// Order/menu data can contain attacker-controlled text (public ordering inserts allow arbitrary
// custom_name/table_no) and gets interpolated into raw HTML for printing — must be escaped.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Stable render order for an order's line items. The local SQLite mirror and Supabase
// return rows in different (and, after an UPDATE, changing) physical orders — without a
// deterministic sort, ticking an item's "prepared" checkbox made the list jump around.
function compareOrderItems(a, b) {
  return (a.batch || 1) - (b.batch || 1)
    || String(a.created_at || '').localeCompare(String(b.created_at || ''))
    || String(a.id).localeCompare(String(b.id));
}

// A bill can be settled across more than one method (part cash, part UPI). Fixed set of
// three, each with its own amount column on `orders` — see database_scripts/add_split_payments.sql.
const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash', column: 'paid_cash' },
  { key: 'upi', label: 'UPI / Online', column: 'paid_upi' },
  { key: 'card', label: 'Card', column: 'paid_card' },
];

// Bill/payment actions hit Supabase directly (no local-server offline buffer, unlike order
// creation) — on a bad connection the request can hang with no feedback, making the button
// look frozen. Race it against a timeout so it fails fast with a retryable error instead.
function withTimeout(promise, ms = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out — check your internet connection and try again.')), ms))
  ]);
}

// Slim shrinking bar so the "add to menu" toast visibly counts down its 5s auto-dismiss.
function ToastTimerBar({ duration }) {
  return (
    <div className="h-1 w-full bg-brand-secondary/30 overflow-hidden">
      <motion.div
        className="h-full bg-brand-primary"
        initial={{ width: '100%' }}
        animate={{ width: '0%' }}
        transition={{ duration: duration / 1000, ease: 'linear' }}
      />
    </div>
  );
}

// After a custom order item is added, offer to save it as a real menu item for next time.
function promptAddToMenu({ name, price, category, description }) {
  toast.custom((t) => (
    <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-sm w-full bg-brand-card shadow-2xl rounded-2xl pointer-events-auto ring-1 ring-brand-primary/20 overflow-hidden relative`}>
      <ToastTimerBar duration={5000} />
      <div className="p-4">
        <p className="text-sm font-black text-brand-text mb-1">New item?</p>
        <p className="text-xs text-brand-text/60 font-medium leading-relaxed mb-3">
          Add "{name}" to the menu for next time?
        </p>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              toast.dismiss(t.id);
              const { error } = await supabase.from('menu_items').insert({
                name,
                price,
                category: category || 'Uncategorized',
                description: description || null,
                is_available: true,
                is_special: false,
                is_todays_special: false
              });
              if (error) toast.error('Failed to add item: ' + error.message);
              else toast.success(`"${name}" added to menu`);
            }}
            className="flex-1 bg-brand-primary text-white text-xs font-bold py-2 rounded-lg hover:bg-brand-primary/90 transition-colors"
          >
            Add to Menu
          </button>
          <button
            onClick={() => toast.dismiss(t.id)}
            className="flex-1 bg-brand-secondary/30 text-brand-text/70 text-xs font-bold py-2 rounded-lg hover:bg-brand-secondary/50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  ), { duration: 5000, position: 'top-right' });
}

export default function Orders({ orders, requests = [], menuItems, inventory = [], tables = [], reservations = [], fetchOrders, fetchRequests, onAddOrder, isLoading }) {
  const [statusFilter, setStatusFilter] = useState('pending');
  const [dateFilter, setDateFilter] = useState('today');
  const [viewMode, setViewMode] = useState('list');
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  const [isLowStockOpen, setIsLowStockOpen] = useState(false);

  const [selectedOrdersForMerge, setSelectedOrdersForMerge] = useState([]);
  const [isMultiMergeModalOpen, setIsMultiMergeModalOpen] = useState(false);

  // Follows the wall clock — this heading was a hardcoded "Good afternoon" that greeted
  // the night shift at 3am. See src/lib/greeting.js.
  const { greeting } = useGreeting();

  // ─── Memoized derived data ───
  const menuItemsMap = useMemo(
    () => new Map(menuItems.map(m => [m.id, m])),
    [menuItems]
  );

  const lowStockItems = useMemo(
    () => inventory.filter(item => item.quantity <= item.min_stock),
    [inventory]
  );
  const hasOutOfStock = useMemo(
    () => lowStockItems.some(i => i.quantity <= 0),
    [lowStockItems]
  );
  
  // Preloaded once and cloned per play. Building a fresh `new Audio()` on every chime and
  // dropping the reference let the browser collect the element mid-load, so the sound
  // played for some orders and silently not for others; it also re-fetched the file each
  // time, which alone could lose the race on a slow disk.
  const chimeRef = useRef(null);
  const pendingChimes = useRef(new Set());
  useEffect(() => {
    const audio = new Audio('./chime.mp3');
    audio.preload = 'auto';
    audio.load();
    chimeRef.current = audio;
  }, []);

  const playChime = useCallback(() => {
    if (!isSoundEnabled) return;
    const base = chimeRef.current;
    if (!base) return;
    try {
      const clone = base.cloneNode();
      clone.volume = 1.0;
      // Held until playback ends so it cannot be collected while still playing.
      clone.addEventListener('ended', () => { pendingChimes.current.delete(clone); });
      pendingChimes.current.add(clone);
      clone.play().catch(() => pendingChimes.current.delete(clone));
    } catch (e) {
      console.error(e);
    }
  }, [isSoundEnabled]);

  useEffect(() => {
    const handleChimeEvent = () => {
      playChime();
    };

    window.addEventListener('new_data_chime', handleChimeEvent);

    return () => {
      window.removeEventListener('new_data_chime', handleChimeEvent);
    };
  }, [playChime]);

  const lowStockRef = useRef(null);
  useEffect(() => {
    function handleClickOutside(event) {
      if (lowStockRef.current && !lowStockRef.current.contains(event.target)) {
        setIsLowStockOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // A custom range can reach further back than App.jsx's rolling 7-day fetch, so this
  // screen loads that range itself rather than silently showing an empty list.
  const [customRange, setCustomRange] = useState(null);
  const [customOrders, setCustomOrders] = useState(null);
  const [isLoadingCustom, setIsLoadingCustom] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const calendarRef = useRef(null);

  // Close the calendar popover on an outside click or Escape.
  useEffect(() => {
    if (!isCalendarOpen) return;
    const onDown = (e) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target)) setIsCalendarOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setIsCalendarOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isCalendarOpen]);

  // Kept as a callable so a card can refresh the view it actually lives in. App-level
  // fetchOrders() only ever loads the last 7 days, so for an older order viewed through
  // the custom range this is the ONLY thing that re-reads it.
  const fetchCustomOrders = useCallback(async ({ showSpinner = true } = {}) => {
    if (dateFilter !== 'custom' || !customRange) return;
    if (showSpinner) setIsLoadingCustom(true);
    const { data } = await supabase
      .from('orders')
      .select('id, table_no, customer_name, mobile_no, status, notes, payment_method, paid_cash, paid_upi, paid_card, discount_type, discount_value, discount_amount, taxable_value, cgst_amount, sgst_amount, round_off, grand_total, order_number, invoice_number, created_at, inventory_deducted, order_items(id, order_id, item_id, quantity, custom_name, price, status, batch, created_at, prepared)')
      .gte('created_at', customRange.fromUtc)
      .lt('created_at', customRange.toUtc)
      .order('created_at', { ascending: false })
      .order('created_at', { referencedTable: 'order_items', ascending: true });
    setCustomOrders(data || []);
    setIsLoadingCustom(false);
  }, [dateFilter, customRange?.fromUtc, customRange?.toUtc]);

  useEffect(() => {
    if (dateFilter !== 'custom' || !customRange) {
      setCustomOrders(null);
      return;
    }
    fetchCustomOrders();
  }, [fetchCustomOrders]);

  // What a card calls after it changes an order. Refreshing only the 7-day `orders` set
  // left the custom view showing pre-edit data, which is why reopening or completing an
  // older order looked like it silently did nothing.
  const refreshVisibleOrders = useCallback(() => {
    fetchOrders();
    if (dateFilter === 'custom') fetchCustomOrders({ showSpinner: false });
  }, [fetchOrders, dateFilter, fetchCustomOrders]);

  // Business days, not midnight: an order taken at 00:45 belongs to the night it was
  // served, so it stays on "Today" until the 5 AM rollover rather than jumping to
  // "Yesterday" the moment the clock passes twelve.
  const dateFilteredOrders = useMemo(() => {
    if (dateFilter === 'custom') return customOrders || [];

    const today = todayBusinessDay();
    return orders.filter(order => {
      const day = businessDayOf(order.created_at);
      if (dateFilter === 'today') return day === today;
      if (dateFilter === 'yesterday') return day === addDays(today, -1);
      if (dateFilter === 'week') return day >= addDays(today, -6);
      return true;
    });
  }, [orders, dateFilter, customOrders]);

  const { pendingOrdersCount, pendingRequestsCount, completedTodayOrders, doneTodayCount } = useMemo(() => {
    const pending = dateFilteredOrders.filter(o => o.status === 'pending').length;
    const pendingReqs = requests.filter(r => r.status === 'pending').length;
    const completed = dateFilteredOrders.filter(o => (o.status === 'done' || o.status === 'paid'));
    return {
      pendingOrdersCount: pending,
      pendingRequestsCount: pendingReqs,
      completedTodayOrders: completed,
      doneTodayCount: completed.length
    };
  }, [dateFilteredOrders, requests]);

  const filteredOrders = useMemo(() => dateFilteredOrders.filter(order => {
    if (statusFilter !== 'all' && order.status !== statusFilter) return false;
    return true;
  }), [dateFilteredOrders, statusFilter]);

  const filteredRequests = useMemo(() => requests.filter(request => {
    if (request.status === 'done') return false;
    if (statusFilter !== 'all' && request.status !== statusFilter) return false;
    // Same business-day rule as the orders above, so requests don't stick across tabs.
    const day = businessDayOf(request.created_at);
    const today = todayBusinessDay();
    if (dateFilter === 'today') return day === today;
    if (dateFilter === 'yesterday') return day === addDays(today, -1);
    if (dateFilter === 'week') return day >= addDays(today, -6);
    if (dateFilter === 'custom' && customRange) return day >= customRange.from && day <= customRange.to;
    return true;
  }), [requests, statusFilter, dateFilter, customRange]);

  const toggleOrderSelection = useCallback((orderId) => {
    setSelectedOrdersForMerge(prev => 
      prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
    );
  }, []);

  const handleMergeSelectedOrders = async (primaryId) => {
    if (selectedOrdersForMerge.length < 2) return;
    
    const ordersToMerge = orders.filter(o => selectedOrdersForMerge.includes(o.id));
    
    const targetOrder = ordersToMerge.find(o => o.id === primaryId) || ordersToMerge[0];
    const sourceOrders = ordersToMerge.filter(o => o.id !== targetOrder.id);
    
    let hasError = false;
    
    for (const source of sourceOrders) {
      // 1. Merge in Supabase
      const { error } = await supabase.rpc('manual_merge_orders', {
        p_target_order_id: targetOrder.id,
        p_source_order_id: source.id
      });
      
      if (error) {
        console.error('Merge error for', source.id, error.message, error.details, error.hint);
        toast.error(`Merge failed: ${error.message || 'Database error'}`);
        hasError = true;
      } else {
        // 2. Merge in Local Server (SQLite) so it doesn't overwrite UI with old unmerged data
        if (window.LOCAL_API_KEY) {
          try {
            const host = window.location.hostname || 'localhost';
            await fetch(`http://${host}:3000/api/orders/manual-merge`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': window.LOCAL_API_KEY
              },
              body: JSON.stringify({
                targetOrderId: targetOrder.id,
                sourceOrderId: source.id
              })
            });
          } catch (localError) {
            console.error('Local merge failed:', localError);
          }
        }
      }
    }
    
    if (hasError) {
      toast.error('Some orders failed to merge. Please check the list.');
    } else {
      toast.success(`Merged ${sourceOrders.length} order(s) into #${targetOrder.id.split('-')[0].toUpperCase()}`);
    }
    
    fetchOrders();
    setSelectedOrdersForMerge([]);
    setIsMultiMergeModalOpen(false);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex justify-between items-end mb-2">
           <div>
             <Skeleton className="w-64 h-10 mb-2" />
             <Skeleton className="w-48 h-5" />
           </div>
           <div className="flex gap-3">
             <Skeleton className="w-10 h-10 rounded-xl" />
             <Skeleton className="w-32 h-10 rounded-xl" />
           </div>
        </div>
        <div>
          <Skeleton className="w-16 h-3 mb-2" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
             {[1, 2, 3].map(i => <Skeleton key={i} className="h-28" />)}
          </div>
        </div>
        <div className="mt-4">
           <Skeleton className="w-48 h-8 mb-4" />
           <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
             {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <Skeleton key={i} className="h-64" />)}
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      
      {/* Greeting Section */}
      <div className="flex justify-between items-end mb-2">
        <div>
          <h2 className="text-2xl md:text-3xl font-black text-brand-text flex items-center gap-2 md:gap-3">
            {greeting}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20 ml-2">
               <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
               <span className="text-[10px] font-bold text-green-600 dark:text-green-400 uppercase tracking-widest">Live</span>
            </div>
          </h2>
          <p className="text-sm font-medium text-brand-text/50 mt-1">
            {format(new Date(), 'EEEE, d MMMM yyyy')}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setIsSoundEnabled(!isSoundEnabled)}
            className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all border shadow-sm ${
              isSoundEnabled 
                ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/30 hover:bg-brand-primary/20' 
                : 'bg-brand-card text-brand-text/40 border-brand-glass-border hover:text-brand-text hover:border-brand-primary/50'
            }`}
            title={isSoundEnabled ? "Mute New Order Sound" : "Enable New Order Sound"}
          >
            {isSoundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          
          <div className="relative" ref={lowStockRef}>
            <button 
              onClick={() => setIsLowStockOpen(!isLowStockOpen)}
              className={`p-2.5 rounded-xl transition-colors relative ${hasOutOfStock ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' : lowStockItems.length > 0 ? 'bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20' : 'bg-brand-secondary/30 text-brand-text/50 hover:bg-brand-secondary/50'}`}
              title="Inventory Alerts"
            >
              {lowStockItems.length === 0 ? <Bell size={20} /> : <AlertTriangle size={20} />}
              {lowStockItems.length > 0 && (
                <span className={`absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm ring-2 ring-brand-bg ${hasOutOfStock ? 'bg-red-500' : 'bg-yellow-500'}`}>
                  {lowStockItems.length}
                </span>
              )}
            </button>
            
            <AnimatePresence>
              {isLowStockOpen && (
                <motion.div 
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 top-full mt-2 w-80 bg-brand-card border border-brand-glass-border rounded-2xl shadow-2xl p-4 z-50 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-brand-text">
                      {lowStockItems.length === 0 ? <Bell size={16} className="text-brand-primary" /> : <AlertTriangle size={16} className={hasOutOfStock ? 'text-red-500' : 'text-yellow-500'} />}
                      <h3 className="text-sm">Inventory Alerts</h3>
                    </div>
                    <button onClick={() => setIsLowStockOpen(false)} className="text-brand-text/50 hover:text-brand-text">
                      <X size={16} />
                    </button>
                  </div>
                  <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1 no-scrollbar">
                    {lowStockItems.length === 0 ? (
                      <div className="p-4 text-center flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-full bg-brand-success/10 flex items-center justify-center mb-1">
                          <Package size={24} className="text-brand-success" />
                        </div>
                        <p className="text-sm font-bold text-brand-text">No Notifications</p>
                        <p className="text-xs text-brand-text/50">All inventory items are well stocked!</p>
                      </div>
                    ) : (
                      lowStockItems.map(item => {
                        const isOut = item.quantity <= 0;
                        return (
                          <div key={item.id} className={`px-3 py-2 rounded-xl text-xs font-bold border shadow-sm flex items-center justify-between gap-2 ${isOut ? 'bg-red-500/10 border-red-500/20' : 'bg-yellow-500/10 border-yellow-500/20'}`}>
                            <span className={`${isOut ? 'text-red-500' : 'text-yellow-600 dark:text-yellow-500'} truncate`}>{item.name}</span>
                            <span className={`opacity-80 px-2 py-0.5 rounded-md text-[10px] whitespace-nowrap ${isOut ? 'bg-red-500/20 text-red-600 dark:text-red-400' : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'}`}>
                              {isOut ? 'Out of Stock' : `${item.quantity} ${item.unit} left`}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button 
            className="bg-brand-primary hover:bg-brand-accent text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors shadow-lg shadow-brand-primary/20 shrink-0"
            onClick={onAddOrder}
          >
            <Plus size={16} /> New Order
          </button>
        </div>
      </div>



      {/* Metrics Row (3 Cards) */}
      <div>
        <h3 className="text-[10px] font-bold text-brand-text/40 tracking-widest uppercase mb-2">Today</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Pending Orders */}
          <div className="bg-brand-card rounded-xl border border-brand-glass-border overflow-hidden relative p-4">
            <div className="absolute top-0 left-0 right-0 h-1 bg-brand-primary"></div>
            <div className="flex justify-between items-start mb-1">
              <div className="text-[10px] font-bold tracking-widest text-brand-text/50 uppercase">Pending</div>
              <Clock size={14} className="text-brand-primary/50" />
            </div>
            <div className="text-2xl font-black text-brand-text mb-0.5">
              {pendingOrdersCount + pendingRequestsCount}
            </div>
            <div className="text-[9px] font-medium text-brand-text/40">orders & requests waiting</div>
          </div>

          {/* Done Orders */}
          <div className="bg-brand-card rounded-xl border border-brand-glass-border overflow-hidden relative p-4">
            <div className="absolute top-0 left-0 right-0 h-1 bg-brand-text/20"></div>
            <div className="flex justify-between items-start mb-1">
              <div className="text-[10px] font-bold tracking-widest text-brand-text/50 uppercase">Completed</div>
              <CheckCircle size={14} className="text-brand-text/30" />
            </div>
            <div className="text-2xl font-black text-brand-text mb-0.5">
              {doneTodayCount}
            </div>
            <div className="text-[9px] font-medium text-brand-text/40">orders today</div>
          </div>

        </div>
      </div>

      {/* Orders Filter Tabs */}
      <div className="flex flex-col md:flex-row justify-between md:items-end gap-4 mt-4 border-b border-brand-glass-border pb-4">
        <div>
           <div className="flex items-center gap-4 mb-2">
             <h3 className="text-lg font-bold text-brand-text">Recent Orders</h3>
             <div className="flex bg-brand-secondary/30 p-1 rounded-lg">
               <button 
                 onClick={() => setViewMode('list')}
                 className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${viewMode === 'list' ? 'bg-brand-primary text-white shadow-sm' : 'text-brand-text/60 hover:text-brand-text'}`}
               >
                 List View
               </button>
               <button 
                 onClick={() => setViewMode('map')}
                 className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${viewMode === 'map' ? 'bg-brand-primary text-white shadow-sm' : 'text-brand-text/60 hover:text-brand-text'}`}
               >
                 Floor Map
               </button>
             </div>
           </div>
           <div className="flex gap-2">
             <button 
               className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${dateFilter === 'today' ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/30' : 'bg-transparent text-brand-text/50 border-brand-glass-border hover:bg-brand-secondary/20'}`}
               onClick={() => setDateFilter('today')}
             >
               Today
             </button>
             <button 
               className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${dateFilter === 'yesterday' ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/30' : 'bg-transparent text-brand-text/50 border-brand-glass-border hover:bg-brand-secondary/20'}`}
               onClick={() => setDateFilter('yesterday')}
             >
               Yesterday
             </button>
             <button 
               className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${dateFilter === 'week' ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/30' : 'bg-transparent text-brand-text/50 border-brand-glass-border hover:bg-brand-secondary/20'}`}
               onClick={() => setDateFilter('week')}
             >
               This Week
             </button>
             {/* Quick tabs stay first so service speed is unaffected — the calendar is
                 opt-in for the owner looking back further than the loaded week, and opens
                 as a popover so it never pushes the order grid down the screen. */}
             <div className="relative" ref={calendarRef}>
               <button
                 className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border flex items-center gap-1 ${dateFilter === 'custom' ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/30' : 'bg-transparent text-brand-text/50 border-brand-glass-border hover:bg-brand-secondary/20'}`}
                 onClick={() => {
                   if (dateFilter !== 'custom' && !customRange) setCustomRange(presetRange('today'));
                   setDateFilter('custom');
                   setIsCalendarOpen(o => !o);
                 }}
               >
                 <CalendarIcon size={11} />
                 {dateFilter === 'custom' && customRange
                   ? (customRange.from === customRange.to ? customRange.from : `${customRange.from} → ${customRange.to}`)
                   : 'Custom'}
               </button>

               {isCalendarOpen && (
                 <div className="absolute left-0 top-full mt-2 z-50 bg-brand-card border border-brand-glass-border rounded-2xl p-4 shadow-2xl animate-slide-up">
                   <div className="flex items-start justify-between mb-3 gap-6">
                     <div>
                       <div className="text-sm font-black text-brand-text">Select a date range</div>
                       <div className="text-[10px] font-medium text-brand-text/40 mt-0.5">
                         Tap a day twice to pick just that day.
                       </div>
                     </div>
                     <button
                       onClick={() => setIsCalendarOpen(false)}
                       aria-label="Close calendar"
                       className="text-brand-text/40 hover:text-brand-text shrink-0"
                     >
                       <X size={16} />
                     </button>
                   </div>

                   <Calendar
                     from={customRange?.from}
                     to={customRange?.to}
                     maxDate={todayBusinessDay()}
                     onSelect={(a, b) => {
                       setCustomRange(businessDayRangeUtc(a, b));
                       setIsCalendarOpen(false);
                     }}
                   />

                   <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-brand-glass-border">
                     <button
                       onClick={() => {
                         setDateFilter('today');
                         setCustomRange(null);
                         setIsCalendarOpen(false);
                       }}
                       className="px-3 py-1.5 rounded-lg text-xs font-bold text-brand-text/60 border border-brand-glass-border hover:bg-brand-secondary/30 hover:text-brand-text transition-colors"
                     >
                       Clear filter
                     </button>
                     {isLoadingCustom && <span className="text-[10px] font-bold text-brand-text/40">Loading…</span>}
                   </div>
                 </div>
               )}
             </div>
           </div>
        </div>
        <div className="flex overflow-x-auto no-scrollbar gap-2 pb-1 w-full md:w-auto">
          <button 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${statusFilter === 'pending' ? 'bg-brand-primary text-white border-brand-primary' : 'bg-brand-secondary/30 text-brand-text/60 hover:bg-brand-secondary/50 border-brand-glass-border'}`}
            onClick={() => setStatusFilter('pending')}
          >
            Pending <span className="ml-1 opacity-70">({pendingOrdersCount + pendingRequestsCount})</span>
          </button>
          <button 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 ${statusFilter === 'done' ? 'bg-brand-primary text-white border-brand-primary' : 'bg-brand-secondary/30 text-brand-text/60 hover:bg-brand-secondary/50 border-brand-glass-border'}`}
            onClick={() => setStatusFilter('done')}
          >
            Done
          </button>
          <button 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${statusFilter === 'paid' ? 'bg-brand-primary text-white border-brand-primary' : 'bg-brand-secondary/30 text-brand-text/60 hover:bg-brand-secondary/50 border-brand-glass-border'}`}
            onClick={() => setStatusFilter('paid')}
          >
            Paid
          </button>
          <button 
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 ${statusFilter === 'all' ? 'bg-brand-primary text-white border-brand-primary' : 'bg-brand-secondary/30 text-brand-text/60 hover:bg-brand-secondary/50 border-brand-glass-border'}`}
            onClick={() => setStatusFilter('all')}
          >
            All
          </button>
        </div>
      </div>

      {viewMode === 'map' ? (
        <div className="w-full bg-brand-bg rounded-2xl border border-brand-glass-border relative min-h-150 overflow-hidden" style={{ backgroundImage: 'radial-gradient(var(--glass-border) 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
          {tables.map(table => {
            const tableOrders = filteredOrders.filter(o => o.table_no?.toString().trim().toLowerCase() === table.table_no?.toString().trim().toLowerCase());
            const tableRequests = filteredRequests.filter(r => r.table_no?.toString().trim().toLowerCase() === table.table_no?.toString().trim().toLowerCase());
            const tableReservations = reservations.filter(r => r.table_id === table.id && (r.status === 'Pending' || r.status === 'Confirmed') && r.reservation_date === new Date().toISOString().split('T')[0]);
            
            let statusColor = 'border-brand-glass-border bg-brand-card text-brand-text/50';
            if (tableOrders.some(o => o.status === 'pending') || tableRequests.some(r => r.status === 'pending')) {
               statusColor = 'border-red-500 bg-red-500/10 text-red-500 shadow-red-500/20';
            } else if (tableReservations.length > 0) {
               statusColor = 'border-yellow-500 bg-yellow-500 text-white shadow-yellow-500/40';
            } else if (tableOrders.some(o => o.status === 'paid')) {
               statusColor = 'border-blue-500 bg-blue-500/10 text-blue-500 shadow-blue-500/20';
            } else if (tableOrders.some(o => o.status === 'done')) {
               statusColor = 'border-green-500 bg-green-500/10 text-green-500 shadow-green-500/20';
            }

            const getShapeClasses = (shape) => {
              switch(shape) {
                case 'circle': return 'rounded-full aspect-square w-24';
                case 'rectangle': return 'rounded-xl w-32 h-20';
                case 'square': default: return 'rounded-xl aspect-square w-24';
              }
            };

            const pendingReqs = tableRequests.filter(r => r.status === 'pending');
            const reqLabel = pendingReqs.length > 0 ? pendingReqs.map(r => r.type === 'waiter' ? '🙋 Waiter' : r.type.startsWith('water') ? `💧 Water x${r.type.split('_')[1] || 1}` : r.type === 'clean' ? '🧹 Clean' : r.type === 'bill' ? '🧾 Bill' : r.type.toLowerCase().startsWith('review') ? '⭐ Review' : r.type).join(', ') : null;

            return (
              <div
                key={table.id}
                className={`absolute flex flex-col items-center justify-center border-2 shadow-lg transition-all ${getShapeClasses(table.shape)} ${statusColor}`}
                style={{ left: `${table.x}%`, top: `${table.y}%` }}
              >
                <span className="font-black text-lg">{table.table_no}</span>
                {tableOrders.length > 0 && <span className="text-[10px] font-bold mt-1 opacity-70">{tableOrders.length} Order(s)</span>}
                {tableOrders.length === 0 && tableReservations.length > 0 && <span className="text-[10px] font-bold mt-1 opacity-70">Reserved</span>}
                {reqLabel && <span className="text-[9px] font-bold mt-0.5 leading-tight text-center animate-pulse">{reqLabel}</span>}
              </div>
            );
          })}
          {tables.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-brand-text/40 font-medium">
              No tables designed. Go to Settings &gt; Floor Plan to create your layout.
            </div>
          )}
        </div>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredOrders.length === 0 && filteredRequests.length === 0 ? (
            <div 
              key="empty" 
              style={{ willChange: 'opacity, transform', animationFillMode: 'both' }}
              className="col-span-full text-center p-12 text-brand-text opacity-50 font-medium min-h-50 flex items-center justify-center animate-slide-up"
            >
              No orders or requests found for the selected filters.
            </div>
          ) : (
            <>
              {filteredRequests.map((request, index) => (
                <RequestCard key={'req-'+request.id} index={index} request={request} refreshRequests={fetchRequests} />
              ))}
              {filteredOrders.map((order, index) => (
                <OrderCard 
                  key={order.id} 
                  index={index + filteredRequests.length} 
                  order={order} 
                  menuItemsMap={menuItemsMap} 
                  refreshOrders={refreshVisibleOrders} 
                  tables={tables} 
                  isSelected={selectedOrdersForMerge.includes(order.id)}
                  onToggleSelection={toggleOrderSelection}
                />
              ))}
            </>
          )}
      </div>
      )}

      {/* Global Merge Selected Button */}
      <AnimatePresence>
        {selectedOrdersForMerge.length > 1 && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 bg-brand-card border border-brand-glass-border shadow-2xl rounded-full px-6 py-3 flex items-center gap-4"
          >
            <div className="text-brand-text font-bold text-sm">
              <span className="text-brand-primary text-lg">{selectedOrdersForMerge.length}</span> Orders Selected
            </div>
            <button 
              className="bg-brand-primary text-white font-bold px-5 py-2 rounded-full shadow-lg shadow-brand-primary/20 flex items-center gap-2 hover:bg-brand-accent transition-colors"
              onClick={() => setIsMultiMergeModalOpen(true)}
            >
              <GitMerge size={16} /> Merge Selected
            </button>
            <button 
              className="w-8 h-8 rounded-full bg-brand-secondary/50 flex items-center justify-center text-brand-text/60 hover:text-brand-text transition-colors"
              onClick={() => setSelectedOrdersForMerge([])}
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Multi-Merge Confirmation Modal */}
      <AnimatePresence>
        {isMultiMergeModalOpen && (
          <MultiMergeConfirmationModal 
            selectedIds={selectedOrdersForMerge}
            allOrders={orders}
            onClose={() => setIsMultiMergeModalOpen(false)}
            onConfirm={handleMergeSelectedOrders}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const RequestCard = React.memo(function RequestCard({ request, index, refreshRequests }) {
  const handleMarkDone = async () => {
    const { error } = await supabase.from('requests').update({ status: 'done' }).eq('id', request.id);
    if (!error) {
      refreshRequests();
      toast.success('Request marked as Done!');
    } else {
      toast.error('Failed to mark request as Done');
    }
  };

  const getIcon = () => {
    if (request.type === 'waiter') return <MessageCircle size={24} className="text-blue-500" />;
    if (request.type.startsWith('water')) return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-500"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>;
    if (request.type === 'clean') return <RefreshCw size={24} className="text-amber-500" />;
    if (request.type === 'bill') return <Receipt size={24} className="text-emerald-500" />;
    if (request.type.toLowerCase().startsWith('review')) return <Star size={24} className="text-amber-400 fill-amber-400" />;
    return <Clock size={24} />;
  };

  const getTitle = () => {
    if (request.type === 'waiter') return 'Call Waiter';
    if (request.type.startsWith('water')) return `Order Water x${request.type.split('_')[1] || 1}`;
    if (request.type === 'clean') return 'Clean Table';
    if (request.type === 'bill') return 'Request Bill';
    if (request.type.toLowerCase().startsWith('review')) return 'Customer Feedback';
    return request.type;
  };

  return (
    <div 
      style={{ 
        willChange: 'opacity, transform',
        animationFillMode: 'both',
        animationDelay: `${(index || 0) * 40}ms`
      }}
      className="relative bg-brand-card rounded-2xl shadow-sm border border-brand-glass-border/80 overflow-hidden flex flex-col h-full hover:shadow-xl hover:-translate-y-1 transition-all duration-300 animate-slide-up"
    >
      <div className={`absolute top-0 left-0 w-full h-1 ${request.status === 'pending' ? 'bg-amber-400' : 'bg-green-500'}`}></div>

      <div className="p-5 flex flex-col h-full">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="text-[10px] font-bold tracking-widest text-brand-text/50 uppercase mb-0.5">Table</div>
            <div className="text-3xl font-black text-brand-text leading-none">{request.table_no || request.table || 'N/A'}</div>
          </div>
          
          <div className="text-right flex flex-col items-end">
            <span className={`px-3 py-0.5 rounded-full text-xs font-bold mb-2 uppercase tracking-wide ${
              request.status === 'pending' ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/20' 
              : 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400'
            }`}>
              {request.status}
            </span>
            <div className="text-[11px] font-semibold text-brand-text/50">
              {format(new Date(request.created_at), 'd MMM, hh:mm a')}
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center my-4 bg-brand-secondary/30 rounded-xl p-4 border border-brand-glass-border border-dashed">
          {getIcon()}
          <span className="mt-2 font-bold text-brand-text text-lg">{getTitle()}</span>
          <span className="text-[10px] uppercase tracking-widest text-brand-text/50 mt-1 font-bold">Table Request</span>
        </div>

        <div className="mt-auto pt-4 border-t border-brand-glass-border flex flex-col gap-3">
          {request.status === 'pending' && (
            <button className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-500 text-white font-bold text-sm rounded-xl hover:bg-green-600 transition-all shadow-sm active:scale-[0.98] border border-green-400/30" onClick={handleMarkDone}>
              <CheckCircle size={18} strokeWidth={2.5} /> Mark as Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

const OrderCard = React.memo(function OrderCard({ order, index, menuItemsMap, refreshOrders, tables, isSelected, onToggleSelection }) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isBillModalOpen, setIsBillModalOpen] = useState(false);
  const [itemsToCancel, setItemsToCancel] = useState([]);
  const [cancelStep, setCancelStep] = useState(1);
  const [cancelMode, setCancelMode] = useState('only');
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);

  // Shows the new status the instant Supabase accepts the change, without waiting for the
  // parent's refetch (which reloads up to 7 days of orders and their line items). Cleared
  // as soon as the refreshed prop agrees, so this can never mask the real value.
  // `{ from, to }` — the override applies only while the prop still reads the OLD value.
  // The moment the refetch lands (or anyone else changes the order) the prop moves off
  // `from` and the real status wins again, so no effect is needed to clear this.
  const [statusOverride, setStatusOverride] = useState(null);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const status = statusOverride && order.status === statusOverride.from
    ? statusOverride.to
    : order.status;

  // Persisted to order_items.prepared (not local state) so the checkmark survives the order
  // moving between filter tabs, which unmounts/remounts this card.
  //
  // Written to BOTH Supabase and the local SQLite mirror: App.jsx uses local orders as the
  // base set on refresh, so a Supabase-only write was overwritten by the stale local row a
  // moment later and the checkmark visibly reset itself.
  const toggleItemChecked = useCallback(async (itemId, currentValue) => {
    const next = !currentValue;
    const { error } = await supabase.from('order_items').update({ prepared: next }).eq('id', itemId);
    if (error) {
      toast.error('Failed to update item');
      return;
    }
    if (window.LOCAL_API_KEY) {
      try {
        const host = window.location.hostname || 'localhost';
        await fetch(`http://${host}:3000/api/order-items/${itemId}/prepared`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-api-key': window.LOCAL_API_KEY },
          body: JSON.stringify({ prepared: next })
        });
      } catch (localError) {
        console.error('Local prepared update failed:', localError);
      }
    }
    refreshOrders();
  }, [refreshOrders]);

  // Helper: resolve item name via O(1) Map lookup
  const getItemName = useCallback((item) => {
    return item.custom_name || menuItemsMap.get(item.item_id)?.name || 'Unknown Item';
  }, [menuItemsMap]);

  // `order.inventory_deducted` was never actually written anywhere, so the old guard
  // (`if (!order.inventory_deducted)`) was always true — every Done/Paid transition re-ran
  // the deduction RPC, silently deducting recipe stock multiple times per order. This reads
  // the current flag fresh from the DB (not the possibly-stale `order` prop) and persists it
  // right after a successful deduction, so a second call is a real no-op.
  const deductInventoryOnce = async (orderId) => {
    const { data: current } = await supabase.from('orders').select('inventory_deducted').eq('id', orderId).single();
    if (current?.inventory_deducted) return;

    const { error: rpcError } = await supabase.rpc('deduct_inventory_for_order', { p_order_id: orderId });
    if (rpcError) {
      toast.error('Inventory deduction failed: ' + rpcError.message);
      return;
    }
    await supabase.from('orders').update({ inventory_deducted: true }).eq('id', orderId);
  };

  const handleMarkDone = async () => {
    if (isChangingStatus) return;
    setIsChangingStatus(true);
    const { error } = await supabase.from('orders').update({ status: 'done' }).eq('id', order.id);
    if (!error) {
      setStatusOverride({ from: order.status, to: 'done' });
      await deductInventoryOnce(order.id);
      refreshOrders();
      toast.success('Order marked as Done!');
    } else {
      toast.error('Failed to mark order as Done');
    }
    setIsChangingStatus(false);
  };

  const handleReopen = async () => {
    if (isChangingStatus) return;
    setIsChangingStatus(true);
    const { error } = await supabase.from('orders').update({ status: 'pending' }).eq('id', order.id);
    if (!error) {
      // Flip the card immediately. The refetch below reloads up to 7 days of orders with
      // every line item, which is what made reopening feel like it had hung for seconds.
      setStatusOverride({ from: order.status, to: 'pending' });
      refreshOrders();
      toast.success('Order reopened');
    } else {
      toast.error('Failed to reopen order');
    }
    setIsChangingStatus(false);
  };

  const handleGenerateBill = () => {
    setIsBillModalOpen(true);
  };

  const handleMarkPaid = async (payment) => {
    if (isMarkingPaid) return;
    setIsMarkingPaid(true);
    try {
      // The full breakdown is persisted alongside the payment split so a reprint shows the
      // same figures the customer actually paid, and so reports can separate tax collected
      // from net revenue. Previously the discount lived only in BillModal's React state.
      const t = payment.totals || {};
      const { error } = await withTimeout(
        supabase.from('orders').update({
          status: 'paid',
          payment_method: payment.summary,
          paid_cash: payment.paid_cash,
          paid_upi: payment.paid_upi,
          paid_card: payment.paid_card,
          discount_type: t.discountType ?? null,
          discount_value: Number(t.discountValueRaw) || 0,
          discount_amount: t.discountAmount ?? 0,
          taxable_value: t.taxableValue ?? null,
          tax_rate_percent: t.taxRatePercent ?? null,
          cgst_amount: t.cgstAmount ?? 0,
          sgst_amount: t.sgstAmount ?? 0,
          round_off: t.roundOff ?? 0,
          grand_total: t.grandTotal ?? null
        }).eq('id', order.id)
      );
      if (error) {
        toast.error('Failed to mark order as Paid: ' + error.message);
        return;
      }

      await deductInventoryOnce(order.id);

      // Add Loyalty Points (1 point per 10 rs spent)
      if (order.mobile_no && order.mobile_no.length === 10) {
        const total = order.order_items?.filter(item => item.status !== 'cancelled').reduce((sum, item) => sum + (item.price * item.quantity), 0) || 0;
        const earnedPoints = Math.floor(total / 10);

        const { data: customer } = await withTimeout(supabase.from('customers').select('id, points, visits, total_spent').eq('phone', order.mobile_no).single());
        if (customer) {
          await supabase.from('customers').update({
            points: customer.points + earnedPoints,
            visits: customer.visits + 1,
            total_spent: Number(customer.total_spent) + total,
            last_visit: new Date().toISOString()
          }).eq('id', customer.id);
        } else if (order.customer_name) {
          await supabase.from('customers').insert({
            phone: order.mobile_no,
            name: order.customer_name,
            points: earnedPoints,
            visits: 1,
            total_spent: total
          });
        }
      }

      refreshOrders();
      setIsBillModalOpen(false);
      toast.success('Order marked as Paid! Points awarded.');
    } catch (err) {
      toast.error(err.message || 'Something went wrong marking the order paid — please try again.');
    } finally {
      setIsMarkingPaid(false);
    }
  };

  const activeItems = order.order_items?.filter(i => i.status !== 'cancelled') || [];

  // The number on the card must be the number on the bill. It used to be a bare sum of
  // item price × qty, which ignored the discount, the GST and the whole-rupee round-off —
  // so the kitchen and the customer were looking at two different figures for one order.
  // billRow reprints the stored breakdown for a settled bill and projects the same math
  // BillModal will apply for one still open. See src/lib/dayReport.js.
  const bill = useMemo(
    () => billRow(order, getTaxRatePercent() ?? 0),
    [order]
  );
  const orderTotal = bill.finalAmount;

  // Detect merged order (has items from multiple batches)
  const batchNumbers = [...new Set(activeItems.map(i => i.batch || 1))];
  const isMergedOrder = batchNumbers.length > 1;

  const openCancelModal = () => {
    setItemsToCancel([]);
    setCancelStep(1);
    setCancelMode('only');
    setIsCancelOpen(true);
  };

  const handleConfirmCancel = async () => {
    if (itemsToCancel.length === 0) return;
    
    const { error } = await supabase
      .from('order_items')
      .update({ status: 'cancelled' })
      .in('id', itemsToCancel);

    if (error) {
      console.error('Failed to cancel items:', error);
      toast.error('Failed to cancel items');
      return;
    }
    
    toast.success('Items cancelled successfully');
    
    let phone = order.mobile_no || '';
    if (phone && phone.length === 10) phone = '91' + phone;

    const cancelledItemsText = itemsToCancel.map(id => {
      const item = activeItems.find(i => i.id === id);
      return getItemName(item || {});
    }).join(', ');

    let msg = `Hi ${order.customer_name || 'there'},\nUnfortunately, we had to cancel the following item(s) from your order:\n*${cancelledItemsText}*`;

    if (cancelMode === 'substitute') {
      const subUrl = new URL('https://orderfromcielo.edgeone.app/');
      subUrl.searchParams.set('mergeOrderId', order.id);
      if (order.customer_name) subUrl.searchParams.set('name', order.customer_name);
      if (order.mobile_no) subUrl.searchParams.set('phone', order.mobile_no);
      msg += `\n\nWould you like to substitute this with something else?\nYou can reply here or use this link to add items: ${subUrl.toString()}`;
    } else {
      msg += `\n\nWe apologize for the inconvenience.`;
    }

    if (phone) {
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
    }

    setIsCancelOpen(false);
    refreshOrders();
  };

  const handlePrintKOT = (batchFilter = null) => {
    const shortId = order.order_number != null
      ? String(order.order_number).padStart(4, '0')
      : (parseInt(order.id.split('-')[0], 16) % 9000 + 1000).toLocaleString('en-US');
    const itemsToPrint = batchFilter 
      ? order.order_items?.filter(i => i.status !== 'cancelled' && (i.batch || 1) === batchFilter)
      : order.order_items?.filter(i => i.status !== 'cancelled');

    const batchLabel = batchFilter ? ` (Added #${batchFilter})` : '';

    // Load settings
    const defaultSettings = {
      print_business_name: 'CIELO cafe & resto',
      print_group_name: '(MIRA GROUP)',
    };
    const savedSettings = JSON.parse(localStorage.getItem('print_settings') || '{}');
    const settings = { ...defaultSettings, ...savedSettings };

    const htmlContent = `
      <html>
        <head>
          <title>KOT - Table ${escapeHtml(order.table_no)}${batchLabel}</title>
          <style>
            @page { margin: 0; size: 58mm auto; }
            body { margin: 0; padding: 0; font-family: Arial, sans-serif; font-size: 11px; color: black; background: white; width: 58mm; }
            .kot-container { width: 58mm; padding: 0 3mm; box-sizing: border-box; }
            .dotted-line { border: none; border-top: 1px dotted black; width: 100%; margin: 0; }
          </style>
        </head>
        <body>
          <div class="kot-container">
            <div style="text-align: center; margin-bottom: 5px;">
              <b style="font-size: 14px;">${escapeHtml(settings.print_business_name)}</b>
            </div>
            <div style="text-align: center; margin-bottom: 5px; line-height: 1.4;">
              <b>Table: ${escapeHtml(order.table_no)}</b><br/>
              <b>Date: ${format(new Date(order.created_at), 'd/M/yy')}</b><br/>
              <b>Waiter: cielocaferestro</b><br/>
              <b>${escapeHtml(settings.print_group_name)}</b><br/>
              <b>Order Id: ${shortId}${batchLabel}</b>
            </div>
            ${order.notes ? `
            <div style="text-align: center; margin-bottom: 5px;">
              <b>Note: ${escapeHtml(order.notes)}</b>
            </div>` : ''}
            <hr style="border: none; border-top: 1px solid black; margin: 5px 0; width: 100%;" />
            ${(itemsToPrint || []).map(item => `
              <div style="display: flex; align-items: flex-start; margin-bottom: 3px;">
                <span style="width: 11mm; shrink-0;">${format(new Date(item.created_at || order.created_at), 'HH:mm')}</span>
                <span style="width: 7mm; text-align: right; padding-right: 2mm;">${item.quantity}x</span>
                <span style="flex: 1; word-wrap: break-word; font-size: 13px; font-weight: bold;">${escapeHtml(getItemName(item))}</span>
              </div>
            `).join('')}
            <!-- Minimum 10 mm gap below where information ends -->
            <div style="height: 10mm;"></div>
            <!-- Dotted line stretched across the KOT -->
            <hr class="dotted-line" />
            <!-- 20mm bottom feed so the printer auto-advances past the cutter without cutting off information or the dotted line -->
            <div style="height: 20mm;"></div>
          </div>
        </body>
      </html>
    `;
    
    try {
      if (window.electronAPI) {
        window.electronAPI.printSilent(htmlContent);
      } else {
        throw new Error('electronAPI not available');
      }
    } catch (e) {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
      
      iframe.contentWindow.document.open();
      iframe.contentWindow.document.write(htmlContent);
      iframe.contentWindow.document.close();
      
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }
  };

  // Cap animation delay at 10 items to prevent UI jank with large lists
  const cappedDelay = Math.min(index || 0, 10) * 40;

  return (
    <div 
      style={{ 
        willChange: 'opacity, transform',
        animationFillMode: 'both',
        animationDelay: `${cappedDelay}ms`
      }}
      className="relative bg-brand-card rounded-2xl shadow-sm border border-brand-glass-border/80 overflow-hidden flex flex-col h-full hover:shadow-xl hover:-translate-y-1 transition-all duration-300 animate-slide-up"
    >
      {/* Top Accent Line */}
      <div className={`absolute top-0 left-0 w-full h-1 ${status === 'pending' ? 'bg-amber-500' : status === 'cancelled' ? 'bg-rose-500' : status === 'paid' ? 'bg-blue-500' : 'bg-green-500'}`}></div>

      <div className="p-5 flex flex-col h-full">
        {/* Header Section */}
        <div className="flex justify-between items-start mb-4">
          <div className="flex gap-3 items-start">
            {(status === 'pending' || status === 'done') && (
              <div className="pt-0.5 shrink-0">
                <div 
                  className={`w-6 h-6 rounded-md border-2 flex items-center justify-center cursor-pointer transition-colors shadow-sm ${isSelected ? 'bg-brand-primary border-brand-primary' : 'bg-brand-card border-brand-glass-border hover:border-brand-primary/50'}`}
                  onClick={(e) => { e.stopPropagation(); onToggleSelection(order.id); }}
                >
                  {isSelected && <Check size={14} className="text-white" strokeWidth={4} />}
                </div>
              </div>
            )}
            <div>
              <div className="text-[10px] font-bold tracking-widest text-brand-text/50 uppercase mb-0.5">Table</div>
              <div className="text-3xl font-black text-brand-text leading-none">{order.table_no || 'N/A'}</div>
              <div className="text-sm font-medium text-brand-text mt-3">{order.customer_name || 'Guest'}</div>
              <div className="text-sm text-brand-text/60 mb-2">{order.mobile_no || 'No phone'}</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="inline-flex items-center gap-1 bg-brand-secondary/50 dark:bg-brand-secondary/20 text-brand-text/80 text-[10px] font-bold px-1.5 py-0.5 rounded shadow-inner">
                   {order.payment_method || 'Online / UPI'}
                </div>
                {isMergedOrder && (
                  <div className="inline-flex items-center gap-1 bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[10px] font-bold px-1.5 py-0.5 rounded border border-purple-500/20">
                    <GitMerge size={10} /> Merged ({batchNumbers.length} rounds)
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="text-right flex flex-col items-end">
            <span className={`px-3 py-0.5 rounded-full text-xs font-bold mb-2 uppercase tracking-wide ${
              status === 'pending' ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400' 
              : status === 'cancelled' ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400'
              : status === 'paid' ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400'
              : 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400'
            }`}>
              {status === 'paid' ? 'Paid' : status}
            </span>
            <div className="text-[11px] font-semibold text-brand-text/50">
              {format(new Date(order.created_at), 'd MMM, hh:mm a')}
            </div>
            {order.notes && (
              <div className="text-sm font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-1 rounded mt-2 max-w-40 text-left">
                Note: {order.notes}
              </div>
            )}
          </div>
        </div>

        {/* Items List — grouped by batch if merged */}
        <div className="flex-1 space-y-2 mb-6 mt-2 max-h-45 overflow-y-auto no-scrollbar pr-1">
          {isMergedOrder ? (
            batchNumbers.sort((a,b) => a-b).map((batch, bIdx) => {
              const batchItems = (order.order_items?.filter(i => (i.batch || 1) === batch) || [])
                .slice()
                .sort(compareOrderItems);
              const batchTime = batchItems.length > 0 ? format(new Date(batchItems[0].created_at || order.created_at), 'hh:mm a') : '';
              const sectionNotes = batchItems.length > 0 ? batchItems[0].section_notes : null;

              return (
                <div key={batch}>
                  {bIdx > 0 && (
                    <div className="flex flex-col my-3">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="flex-1 h-px bg-purple-500/20"></div>
                        <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full uppercase tracking-widest border border-purple-500/20">Merged Round #{batch}</span>
                        <span className="text-[10px] font-semibold text-brand-text/50">{batchTime}</span>
                        <div className="flex-1 h-px bg-purple-500/20"></div>
                      </div>
                      {sectionNotes && (
                        <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-1 rounded w-fit mx-auto mt-1 mb-2">
                          Note: {sectionNotes}
                        </div>
                      )}
                    </div>
                  )}
                  {batchItems.map(item => {
                    const isCancelled = item.status === 'cancelled';
                    const isChecked = item.prepared || false;
                    return (
                      <div key={item.id} onClick={() => !isCancelled && toggleItemChecked(item.id, isChecked)} className={`flex items-center p-2.5 rounded-xl border border-brand-glass-border/40 mb-1.5 cursor-pointer select-none transition-all ${isCancelled ? 'bg-red-500/10 opacity-70' : isChecked ? 'bg-green-500/10 border-green-500/30' : bIdx > 0 ? 'bg-purple-500/5 dark:bg-purple-500/5 border-purple-500/20' : 'bg-brand-secondary/30 dark:bg-brand-secondary/10'}`}>
                        {!isCancelled && (
                          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center mr-2 shrink-0 transition-colors ${isChecked ? 'bg-green-500 border-green-500' : 'border-brand-glass-border bg-brand-card'}`}>
                            {isChecked && <Check size={12} className="text-white" strokeWidth={3} />}
                          </div>
                        )}
                        <div className={`text-brand-text font-bold w-7 h-7 flex items-center justify-center rounded-lg text-sm mr-3 shadow-sm shrink-0 ${isCancelled ? 'bg-red-500/20 text-red-600' : 'bg-brand-card'}`}>
                          {item.quantity}
                        </div>
                        <div className={`text-sm font-semibold flex-1 ${isCancelled ? 'text-red-600 dark:text-red-400 line-through' : isChecked ? 'text-green-600 dark:text-green-400 line-through opacity-70' : 'text-brand-text/90'}`}>
                          {getItemName(item)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          ) : (
            [...(order.order_items || [])].sort(compareOrderItems).map(item => {
              const isCancelled = item.status === 'cancelled';
              const isChecked = item.prepared || false;
              return (
                <div key={item.id} onClick={() => !isCancelled && toggleItemChecked(item.id, isChecked)} className={`flex items-center p-2.5 rounded-xl border border-brand-glass-border/40 cursor-pointer select-none transition-all ${isCancelled ? 'bg-red-500/10 dark:bg-red-500/10 opacity-70' : isChecked ? 'bg-green-500/10 border-green-500/30' : 'bg-brand-secondary/30 dark:bg-brand-secondary/10'}`}>
                  {!isCancelled && (
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center mr-2 shrink-0 transition-colors ${isChecked ? 'bg-green-500 border-green-500' : 'border-brand-glass-border bg-brand-card'}`}>
                      {isChecked && <Check size={12} className="text-white" strokeWidth={3} />}
                    </div>
                  )}
                  <div className={`text-brand-text font-bold w-7 h-7 flex items-center justify-center rounded-lg text-sm mr-3 shadow-sm shrink-0 ${isCancelled ? 'bg-red-500/20 text-red-600' : 'bg-brand-card'}`}>
                    {item.quantity}
                  </div>
                  <div className={`text-sm font-semibold ${isCancelled ? 'text-red-600 dark:text-red-400 line-through' : isChecked ? 'text-green-600 dark:text-green-400 line-through opacity-70' : 'text-brand-text/90'}`}>
                    {getItemName(item)}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer & Actions */}
        <div className="mt-auto pt-4 border-t border-brand-glass-border flex flex-col gap-3">
          
          <div className="flex justify-between items-center mb-1">
            <div>
              <div className="text-2xl font-black text-brand-text leading-none">₹{orderTotal.toFixed(2)}</div>
              {/* Spell out why the figure differs from the item prices, so nobody reads a
                  discounted bill as a mistake. */}
              {(bill.discountAmount > 0 || bill.gstAmount > 0) && (
                <div className="text-[10px] font-bold text-brand-text/40 mt-1 flex items-center gap-1.5">
                  <span>₹{bill.subtotal.toFixed(2)}</span>
                  {bill.discountAmount > 0 && (
                    <span className="text-red-500">
                      −₹{bill.discountAmount.toFixed(2)}{bill.discountLabel ? ` (${bill.discountLabel})` : ''}
                    </span>
                  )}
                  {bill.gstAmount > 0 && <span className="text-brand-text/40">+GST ₹{bill.gstAmount.toFixed(2)}</span>}
                </div>
              )}
            </div>
            <div className="text-[10px] text-brand-text/50 font-mono font-bold tracking-wider bg-brand-secondary/50 px-2 py-1 rounded-md">#{order.id.split('-')[0].toUpperCase()}</div>
          </div>
          
          <div className="flex gap-2">
            {status === 'pending' && (
              <>

                {isMergedOrder && (
                  <button className="flex-[1.5] flex items-center justify-center gap-1.5 py-2.5 bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 font-bold text-[11px] rounded-xl hover:bg-purple-100 dark:hover:bg-purple-500/20 transition-colors border border-purple-200 dark:border-purple-500/30" onClick={() => handlePrintKOT(Math.max(...batchNumbers))}>
                    <Printer size={12} /> Latest KOT
                  </button>
                )}
                <button className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-brand-secondary/50 dark:bg-brand-secondary/20 text-brand-text font-bold text-xs rounded-xl hover:bg-brand-secondary transition-colors border border-brand-glass-border" onClick={() => handlePrintKOT()}>
                   {isMergedOrder ? 'Full KOT' : 'KOT'}
                </button>
                <button className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-brand-secondary/50 dark:bg-brand-secondary/20 text-brand-text font-bold text-xs rounded-xl hover:bg-brand-secondary transition-colors border border-brand-glass-border" onClick={() => setIsEditOpen(true)}>
                   Edit
                </button>
                <button className="flex items-center justify-center w-12 bg-red-50 text-red-500 dark:bg-red-500/20 dark:text-red-400 rounded-xl hover:bg-red-100 dark:hover:bg-red-500/30 transition-colors shrink-0 border border-red-200 dark:border-red-500/30" onClick={openCancelModal}>
                  <X size={20} strokeWidth={2.5} />
                </button>
              </>
            )}
            {status === 'done' && (
              <>
                <button className="flex-1 flex items-center justify-center py-2.5 bg-brand-secondary/50 dark:bg-brand-secondary/20 text-brand-text font-bold text-xs rounded-xl hover:bg-brand-secondary transition-colors border border-brand-glass-border" onClick={handleReopen}>
                   Reopen
                </button>
                <button className="flex-2 flex items-center justify-center py-2.5 bg-[#2563eb] text-white font-bold text-xs rounded-xl hover:bg-blue-700 transition-colors shadow-md shadow-blue-500/20 border border-blue-400/30" onClick={handleGenerateBill}>
                   Generate Bill
                </button>
              </>
            )}
            {status === 'paid' && (
              <>
                <button className="flex-1 flex items-center justify-center py-2.5 bg-brand-secondary/50 dark:bg-brand-secondary/20 text-brand-text font-bold text-xs rounded-xl hover:bg-brand-secondary transition-colors border border-brand-glass-border" onClick={handleReopen}>
                   Reopen
                </button>
                <button className="flex-2 flex items-center justify-center py-2.5 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold text-xs rounded-xl hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors border border-blue-200 dark:border-blue-500/30" onClick={() => setIsBillModalOpen(true)}>
                   Edit Bill
                </button>
              </>
            )}
            {status === 'cancelled' && (
              <button className="flex-1 flex items-center justify-center py-2.5 bg-brand-secondary/50 dark:bg-brand-secondary/20 text-brand-text font-bold text-xs rounded-xl hover:bg-brand-secondary transition-colors border border-brand-glass-border" onClick={handleReopen}>
                 Restore Order
              </button>
            )}
          </div>

          {status === 'pending' && (
            <button className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-500 text-white font-bold text-sm rounded-xl hover:bg-green-600 transition-all shadow-sm active:scale-[0.98] border border-green-400/30" onClick={handleMarkDone}>
              <CheckCircle size={18} strokeWidth={2.5} /> Mark as Done
            </button>
          )}
        </div>
      </div>

      {/* Cancel Modal — conditional portal */}
      {isCancelOpen && createPortal(
        <AnimatePresence>
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsCancelOpen(false)}></motion.div>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-brand-card rounded-3xl shadow-xl w-[95%] sm:w-full max-w-110 flex flex-col max-h-[90vh] overflow-hidden z-10 relative">
            
            {cancelStep === 1 ? (
              <>
                <div className="p-6 md:p-8 pb-6 text-center overflow-y-auto">
                  <h3 className="text-2xl font-black text-brand-text mb-1">Table {order.table_no}</h3>
                  <p className="text-sm font-medium text-brand-text/50 mb-8">{order.customer_name}</p>
                  
                  <p className="text-sm text-brand-text/60 mb-3">Select items to cancel</p>
                  
                  <button 
                    className="w-full bg-brand-secondary/30 dark:bg-brand-secondary/10 text-brand-primary font-bold py-3.5 rounded-2xl mb-4 hover:bg-brand-secondary/50 transition-colors border border-transparent hover:border-brand-glass-border shadow-sm"
                    onClick={() => {
                      if (itemsToCancel.length === activeItems.length) {
                        setItemsToCancel([]);
                      } else {
                        setItemsToCancel(activeItems.map(i => i.id));
                      }
                    }}
                  >
                    {itemsToCancel.length === activeItems.length ? 'Deselect All' : 'Select All'}
                  </button>

                  <div className="flex flex-col gap-2.5 max-h-[40vh] overflow-y-auto no-scrollbar text-left p-1">
                    {activeItems.map(item => {
                       const isSelected = itemsToCancel.includes(item.id);
                       return (
                         <label 
                           key={item.id} 
                           className="flex items-center p-3.5 rounded-2xl bg-brand-secondary/30 dark:bg-brand-secondary/10 border border-transparent hover:border-brand-glass-border cursor-pointer hover:bg-brand-secondary/50 transition-all shadow-sm"
                           onClick={(e) => {
                             e.preventDefault();
                             if (isSelected) {
                               setItemsToCancel(prev => prev.filter(id => id !== item.id));
                             } else {
                               setItemsToCancel(prev => [...prev, item.id]);
                             }
                           }}
                         >
                           <div className={`w-5 h-5 rounded-sm border flex items-center justify-center mr-4 transition-colors ${isSelected ? 'bg-brand-primary border-brand-primary' : 'bg-brand-card border-brand-glass-border'}`}>
                             {isSelected && <Check size={14} className="text-white" strokeWidth={4} />}
                           </div>
                           <span className="text-[15px] font-bold text-brand-text">{getItemName(item)} <span className="opacity-50 font-semibold ml-1">(×{item.quantity})</span></span>
                         </label>
                       )
                    })}
                  </div>
                </div>

                <div className="p-4 bg-brand-card flex gap-3 border-t border-brand-glass-border">
                  <button className="flex-1 py-4 text-brand-text font-bold bg-brand-card border border-brand-glass-border rounded-2xl hover:bg-brand-secondary transition-colors shadow-sm" onClick={() => setIsCancelOpen(false)}>
                    Go Back
                  </button>
                  <button className="flex-1 py-4 text-white font-bold bg-brand-primary rounded-2xl hover:bg-blue-800 transition-colors shadow-md disabled:opacity-50 disabled:shadow-none" disabled={itemsToCancel.length === 0} onClick={() => setCancelStep(2)}>
                    Next →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-8 pb-6 text-center">
                  <h3 className="text-2xl font-black text-brand-text mb-1">Table {order.table_no}</h3>
                  <p className="text-sm font-medium text-brand-text/50 mb-6">{order.customer_name}</p>
                  
                  <p className="text-[13px] font-semibold text-brand-text/50 mb-4">What should happen next?</p>
                  
                  <div className="bg-[#fff1f2] dark:bg-red-500/10 border border-[#fecdd3] dark:border-red-500/30 rounded-xl p-3 mb-6 flex items-center gap-3 text-left">
                    <Ban size={16} className="text-[#e11d48] shrink-0" />
                    <div className="text-[13px] text-[#be123c] dark:text-red-400 font-medium">
                      Cancelling: {itemsToCancel.map(id => {
                        const item = activeItems.find(i => i.id === id);
                        return getItemName(item || {});
                      }).join(', ')}
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-3">
                    <div 
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${cancelMode === 'only' ? 'border-brand-primary bg-brand-primary/5' : 'border-[#e5e7eb] dark:border-brand-glass-border bg-[#f9fafb] dark:bg-brand-secondary/20 hover:border-brand-glass-border/80'}`}
                      onClick={() => setCancelMode('only')}
                    >
                      <div className={`p-2.5 rounded-lg ${cancelMode === 'only' ? 'bg-brand-primary text-white' : 'bg-[#e5e7eb] dark:bg-brand-secondary text-gray-500 dark:text-brand-text/50'}`}>
                        <Trash2 size={20} />
                      </div>
                      <div className="text-left">
                        <div className="font-bold text-brand-text text-[15px] mb-0.5">Cancel Only</div>
                        <div className="text-[11px] text-brand-text/60">Remove items. Notify customer via WhatsApp.</div>
                      </div>
                    </div>
                    
                    <div 
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${cancelMode === 'substitute' ? 'border-brand-primary bg-brand-primary/5' : 'border-[#e5e7eb] dark:border-brand-glass-border bg-[#f9fafb] dark:bg-brand-secondary/20 hover:border-brand-glass-border/80'}`}
                      onClick={() => setCancelMode('substitute')}
                    >
                      <div className={`p-2.5 rounded-lg ${cancelMode === 'substitute' ? 'bg-brand-primary text-white' : 'bg-[#e5e7eb] dark:bg-brand-secondary text-gray-500 dark:text-brand-text/50'}`}>
                        <RefreshCw size={20} />
                      </div>
                      <div className="text-left">
                        <div className="font-bold text-brand-text text-[15px] mb-0.5">Cancel & Ask for Substitution</div>
                        <div className="text-[11px] text-brand-text/60">Notify customer and hold order in "Awaiting" state.</div>
                      </div>
                    </div>
                  </div>

                </div>

                <div className="p-4 bg-brand-card flex gap-3 border-t border-brand-glass-border">
                  <button className="flex-1 py-4 text-brand-text font-bold bg-brand-card border border-brand-glass-border rounded-2xl hover:bg-brand-secondary transition-colors shadow-sm" onClick={() => setCancelStep(1)}>
                    ← Back
                  </button>
                  <button className="flex-1 py-4 text-white font-bold bg-[#9bb6d6] hover:bg-[#83a4c9] rounded-2xl transition-colors shadow-md" onClick={handleConfirmCancel}>
                    Confirm
                  </button>
                </div>
              </>
            )}

          </motion.div>
        </div>
        </AnimatePresence>,
        document.body
      )}

      {/* Edit Modal — conditional portal */}
      {isEditOpen && createPortal(
        <AnimatePresence>
        <div className="fixed inset-0 z-100 flex items-center justify-center">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsEditOpen(false)}></motion.div>
          <OrderModal 
            order={order}
            menuItems={[...menuItemsMap.values()]}
            tables={tables}
            onClose={() => setIsEditOpen(false)}
            onSave={() => {
              setIsEditOpen(false);
              refreshOrders();
            }}
          />
        </div>
        </AnimatePresence>,
        document.body
      )}

      {/* Bill Modal — conditional portal */}
      {isBillModalOpen && createPortal(
        <AnimatePresence>
        <BillModal 
          order={order} 
          menuItems={[...menuItemsMap.values()]}
          onClose={() => setIsBillModalOpen(false)}
          onMarkPaid={handleMarkPaid}
          isMarkingPaid={isMarkingPaid}
        />
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
});

export function OrderModal({ order, menuItems, tables = [], onClose, onSave }) {
  const isEdit = !!order;
  const [customerName, setCustomerName] = useState(order?.customer_name || '');
  const [mobileNo, setMobileNo] = useState(order?.mobile_no || '');
  const [tableNo, setTableNo] = useState(order?.table_no || '');
  const [notes, setNotes] = useState(order?.notes || '');
  const [paymentMethod, setPaymentMethod] = useState(order?.payment_method || 'Online / UPI');
  const [orderItems, setOrderItems] = useState(order?.order_items || []);
  
  const [customerPoints, setCustomerPoints] = useState(0);
  const [usePoints, setUsePoints] = useState(false);
  const [customerLookupLoading, setCustomerLookupLoading] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const categoriesScrollRef = useRef(null);
  const scrollCategories = (direction) => {
    categoriesScrollRef.current?.scrollBy({ left: direction * 200, behavior: 'smooth' });
  };

  useEffect(() => {
    if (String(mobileNo).length === 10 && !isEdit) {
      const checkCustomer = async () => {
        setCustomerLookupLoading(true);
        const { data } = await supabase.from('customers').select('name, points').eq('phone', mobileNo).single();
        if (data) {
          if (!customerName) setCustomerName(data.name);
          setCustomerPoints(data.points);
        } else {
          setCustomerPoints(0);
          setUsePoints(false);
        }
        setCustomerLookupLoading(false);
      };
      checkCustomer();
    } else {
      setCustomerPoints(0);
      setUsePoints(false);
    }
  }, [mobileNo, isEdit, customerName]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  
  const [customItemName, setCustomItemName] = useState('');
  const [customItemPrice, setCustomItemPrice] = useState('');
  const [customItemNotes, setCustomItemNotes] = useState('');
  const [customItemCategory, setCustomItemCategory] = useState('');
  const [showCustomItem, setShowCustomItem] = useState(false);
  const isAddingCustomItemRef = useRef(false);

  // Derived state
  const menuCategories = useMemo(
    () => [...new Set(menuItems.map(item => item.category).filter(Boolean))].sort(),
    [menuItems]
  );
  const categories = useMemo(() => ['All', ...menuCategories], [menuCategories]);

  const filteredMenuItems = useMemo(() => menuItems.filter(item => {
    const safeName = item.name || '';
    const matchesSearch = safeName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    // Don't show custom items or unavailable items in the grid if you wanted to filter them
    return matchesSearch && matchesCategory;
  }), [menuItems, searchQuery, selectedCategory]);

  const cartTotal = orderItems.filter(item => item.status !== 'cancelled').reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const discountAmount = usePoints ? Math.min(customerPoints, cartTotal) : 0;

  // Display-only estimate matching what the final Bill will charge (GST is exclusive, added
  // on the discounted subtotal) — doesn't affect what's stored in order_items or loyalty
  // points, both of which stay based on the pre-tax item total.
  const taxRatePercentEstimate = parseFloat(JSON.parse(localStorage.getItem('print_settings') || '{}').tax_rate) || 0;
  const taxableValueEstimate = cartTotal - discountAmount;
  const cgstEstimate = taxableValueEstimate * (taxRatePercentEstimate / 2) / 100;
  const sgstEstimate = cgstEstimate;
  const finalTotal = taxableValueEstimate + cgstEstimate + sgstEstimate;

  const handleAddItemToCart = (menuItem) => {
    setOrderItems(prev => {
      const existingItem = prev.find(item => item.item_id === menuItem.id);
      if (existingItem) {
        return prev.map(item => item.item_id === menuItem.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, {
        id: crypto.randomUUID(), 
        item_id: menuItem.id,
        quantity: 1,
        price: menuItem.price,
        status: 'active'
      }];
    });
  };

  const handleUpdateQuantity = (id, delta) => {
    setOrderItems(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  const handleAddCustomItem = () => {
    if (!customItemName || !customItemPrice) return;
    // Guard against double-firing on a rapid double-click (was adding the item + toast twice)
    if (isAddingCustomItemRef.current) return;
    isAddingCustomItemRef.current = true;

    const finalName = customItemNotes ? `${customItemName} (${customItemNotes})` : customItemName;
    const price = parseFloat(customItemPrice);
    setOrderItems(prev => [...prev, {
      id: crypto.randomUUID(),
      custom_name: finalName,
      quantity: 1,
      price,
      status: 'active'
    }]);

    const alreadyOnMenu = menuItems.some(
      m => (m.name || '').trim().toLowerCase() === customItemName.trim().toLowerCase()
    );
    if (!alreadyOnMenu) {
      promptAddToMenu({ name: customItemName, price, category: customItemCategory, description: customItemNotes });
    }

    setCustomItemName('');
    setCustomItemPrice('');
    setCustomItemNotes('');
    setCustomItemCategory('');
    setShowCustomItem(false);
  };

  const handleRemoveItem = (id) => {
    setOrderItems(prev => prev.filter(item => item.id !== id));
  };



  const handleSave = async (forceSeparate = false) => {
    // The table/phone inputs are marked `required` but this isn't a <form>, so the browser
    // never actually validates them — enforce it here instead of silently saving blank values.
    if (!tableNo) {
      toast.error('Please select a table');
      return;
    }
    if (!mobileNo || mobileNo.length !== 10) {
      toast.error('Please enter a valid 10-digit phone number');
      return;
    }

    setIsSaving(true);
    let currentOrderId = order?.id;

    const orderData = { 
      customer_name: customerName, 
      mobile_no: mobileNo, 
      table_no: String(tableNo).trim().replace(/^(\d+)$/, 'T$1'),
      payment_method: paymentMethod
    };

    try {
      if (!isEdit) {
        const { data: newOrder, error: orderError } = await supabase
          .from('orders')
          .insert({ ...orderData, notes, status: 'pending' })
          .select()
          .single();
        
        if (orderError) throw orderError;
        currentOrderId = newOrder.id;
        
        // Define it globally within handleSave so we can use it for the toast later
        var newOrderObj = newOrder;
      } else {
        const { error } = await supabase.from('orders').update({ ...orderData, notes }).eq('id', currentOrderId);
        if (error) throw error;
        // The delete result was previously unchecked — if it failed (RLS, connectivity) the
        // re-insert below would duplicate every line item instead of replacing it.
        const { error: deleteError } = await supabase.from('order_items').delete().eq('order_id', currentOrderId);
        if (deleteError) throw deleteError;
      }
    } catch (err) {
      toast.error("Database error: " + err.message);
      setIsSaving(false);
      return;
    }

    // On edit, all order_items were deleted and re-inserted from scratch (above). Re-insert
    // the FULL list (not just active ones) preserving `batch`, so editing a merged/reordered
    // order doesn't collapse its batch history to 1 and silently un-cancel previously
    // cancelled items by dropping them.
    //
    // `id`, `prepared` and `section_notes` are carried across too. Without them, adding a
    // reorder to an existing order wiped every KDS checkmark the kitchen had already ticked
    // (the order returns to `pending` with all its boxes cleared), threw away the per-round
    // notes on merged orders, and minted fresh item ids that orphaned the local SQLite
    // mirror's rows for those items. Items added in this modal carry a client-generated
    // UUID, so keeping the id is safe for new and existing lines alike.
    if (orderItems.length > 0) {
      const itemsToInsert = orderItems.map(item => ({
        ...(item.id ? { id: item.id } : {}),
        order_id: currentOrderId,
        item_id: item.item_id || null,
        custom_name: item.custom_name || null,
        quantity: item.quantity,
        price: item.price,
        status: item.status || 'pending',
        batch: item.batch || 1,
        prepared: item.prepared || false,
        section_notes: item.section_notes ?? null
      }));

      if (usePoints && discountAmount > 0) {
        itemsToInsert.push({
          order_id: currentOrderId,
          custom_name: 'Loyalty Points Redeemed',
          quantity: 1,
          price: -discountAmount,
          status: 'active',
          batch: 1
        });
        
        // Deduct points from customer balance
        await supabase.from('customers').update({ points: customerPoints - discountAmount }).eq('phone', mobileNo);
      }
      
      await supabase.from('order_items').insert(itemsToInsert);
    }

    if (typeof newOrderObj !== 'undefined' && newOrderObj && newOrderObj.status === 'merged') {
      toast.success('Order merged with previous active order!');
    } else {
      toast.success(isEdit ? 'Order updated successfully' : 'Order created successfully');
    }
    setIsSaving(false);
    onSave();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="bg-brand-bg rounded-2xl shadow-2xl flex flex-col w-[95vw] max-w-6xl h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 lg:p-6 border-b border-brand-glass-border bg-brand-card">
          <div>
            <h2 className="m-0 text-2xl font-bold">{isEdit ? 'Edit Order' : 'New Order'}</h2>
            <p className="m-0 text-sm opacity-70 mt-1">Build order from menu</p>
          </div>
          <button className="btn-icon bg-brand-secondary/50 hover:bg-brand-danger/10 hover:text-brand-danger p-2 rounded-xl" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        
        {/* Top Inputs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 p-4 border-b border-brand-glass-border bg-brand-card/50">
          <select 
            value={tableNo} 
            onChange={e => setTableNo(e.target.value)} 
            required 
            className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-shadow appearance-none"
          >
            <option value="" disabled>Select Table *</option>
            {tables.map(t => (
              <option key={t.id} value={t.table_no}>Table {t.table_no}</option>
            ))}
          </select>
          <input type="text" placeholder="Customer Name" className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-shadow" value={customerName} onChange={e => setCustomerName(e.target.value)} />
          <input 
            type="text" 
            placeholder="Phone (10 digits) *" 
            className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-shadow" 
            value={mobileNo} 
            onChange={e => {
              const val = e.target.value.replace(/\D/g, '');
              if (val.length <= 10) setMobileNo(val);
            }} 
            maxLength={10}
            required
          />
          {customerLookupLoading && <div className="text-[10px] text-brand-primary animate-pulse absolute">Looking up...</div>}
          <input type="text" placeholder="Notes (Optional)" className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-shadow col-span-2 md:col-span-1" value={notes} onChange={e => setNotes(e.target.value)} />
          <select className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-shadow col-span-2 md:col-span-1" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
            <option>Cash</option>
            <option>Card</option>
            <option>Online / UPI</option>
          </select>
        </div>

        {customerPoints > 0 && !isEdit && (
          <div className="bg-brand-primary/10 border-b border-brand-primary/20 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-brand-primary font-bold text-sm">
              <Star size={16} /> 
              <span>{customerName || 'Customer'} has {customerPoints} loyalty points available.</span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded text-brand-primary bg-brand-bg/50 border-brand-glass-border focus:ring-brand-primary" checked={usePoints} onChange={(e) => setUsePoints(e.target.checked)} />
              <span className="text-sm font-bold text-brand-text">Redeem Points (-₹{Math.min(customerPoints, cartTotal)})</span>
            </label>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-brand-bg">
          
          {/* Left Area: Menu Grid (approx 2/3 width) */}
          <div className="flex-2 flex flex-col border-b lg:border-b-0 lg:border-r border-brand-glass-border h-full overflow-hidden">
            
            {/* Search and Categories */}
            <div className="p-4 border-b border-brand-glass-border space-y-4 bg-brand-card">
              <input 
                type="text" 
                placeholder="Search menu..." 
                className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text shadow-inner focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-shadow"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="shrink-0 p-1.5 rounded-full border border-brand-glass-border/50 text-brand-text/60 hover:text-brand-text hover:bg-brand-secondary transition-colors"
                  onClick={() => scrollCategories(-1)}
                  aria-label="Scroll categories left"
                >
                  <ChevronLeft size={16} />
                </button>
                <div ref={categoriesScrollRef} className="flex gap-2 overflow-x-auto pb-1 snap-x no-scrollbar">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      className={`btn whitespace-nowrap snap-start text-sm py-2 px-5 rounded-full border border-brand-glass-border/50 shadow-sm transition-colors ${selectedCategory === cat ? 'bg-brand-primary text-white border-transparent' : 'bg-brand-bg text-brand-text hover:bg-brand-secondary'}`}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="shrink-0 p-1.5 rounded-full border border-brand-glass-border/50 text-brand-text/60 hover:text-brand-text hover:bg-brand-secondary transition-colors"
                  onClick={() => scrollCategories(1)}
                  aria-label="Scroll categories right"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {/* Menu Items Grid */}
            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredMenuItems.map(item => (
                  <button 
                    key={item.id} 
                    className="flex flex-col text-left p-4 rounded-xl bg-brand-card border border-brand-glass-border shadow-sm hover:border-brand-primary/50 hover:shadow-md hover:-translate-y-0.5 transition-all h-28 group"
                    onClick={() => handleAddItemToCart(item)}
                  >
                    <span className="font-semibold text-sm line-clamp-2 mb-auto leading-snug group-hover:text-brand-primary transition-colors">{item.name}</span>
                    <span className="font-bold text-brand-primary mt-3 text-lg">₹{(item.price || 0).toFixed(2)}</span>
                  </button>
                ))}
              </div>
              
              {filteredMenuItems.length === 0 && (
                <div className="flex items-center justify-center h-full text-brand-text opacity-40 italic">
                  No items found.
                </div>
              )}
            </div>

            {/* Custom Item Bottom Bar */}
            <div className="p-3 border-t border-brand-glass-border bg-brand-card">
              <button className="w-full text-center py-2 text-brand-text opacity-60 font-medium hover:opacity-100 hover:text-brand-primary transition-colors text-sm" onClick={() => { isAddingCustomItemRef.current = false; setShowCustomItem(true); }}>
                + Custom Item
              </button>
            </div>
          </div>

          {/* Right Area: Cart (approx 1/3 width) */}
          <div className="flex-1 flex flex-col bg-brand-secondary/30 h-full">
            <div className="p-4 bg-[#e6f3fa] dark:bg-brand-secondary/50 font-bold border-b border-brand-glass-border text-sm flex justify-between items-center">
              Current Order
              <span className="bg-brand-primary text-white text-xs px-2 py-0.5 rounded-full">{orderItems.filter(i => i.status !== 'cancelled').length} items</span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {orderItems.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-brand-text opacity-40 font-medium italic">
                  Cart is empty
                </div>
              ) : (
                orderItems.map(item => (
                  <div key={item.id} className={`flex flex-col p-3.5 rounded-xl bg-brand-card shadow-sm border border-brand-glass-border/50 ${item.status === 'cancelled' ? 'opacity-50 grayscale' : ''}`}>
                    <div className="flex justify-between items-start mb-3">
                      <div className="font-semibold text-sm pr-2 line-clamp-2 leading-snug">{item.custom_name || menuItems.find(m => m.id === item.item_id)?.name}</div>
                      <div className="text-brand-primary font-bold whitespace-nowrap">₹{(item.price * item.quantity).toFixed(2)}</div>
                    </div>
                    
                    <div className="flex justify-between items-center mt-auto">
                      {item.status !== 'cancelled' ? (
                        <div className="flex items-center gap-1 bg-brand-secondary/50 rounded-lg p-1 border border-brand-glass-border/30">
                          <button className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white dark:hover:bg-brand-secondary hover:shadow-sm transition-all text-lg leading-none" onClick={() => handleUpdateQuantity(item.id, -1)}>-</button>
                          <span className="w-8 text-center text-sm font-bold">{item.quantity}</span>
                          <button className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white dark:hover:bg-brand-secondary hover:shadow-sm transition-all text-lg leading-none" onClick={() => handleUpdateQuantity(item.id, 1)}>+</button>
                        </div>
                      ) : (
                        <span className="text-xs font-bold text-brand-danger uppercase tracking-wider">Cancelled</span>
                      )}
                      
                      {item.status !== 'cancelled' && (
                        <button className="text-xs font-semibold text-brand-danger opacity-70 hover:opacity-100 flex items-center gap-1 px-2 py-1 rounded hover:bg-brand-danger/10 transition-colors" onClick={() => handleRemoveItem(item.id)}>
                          <Trash2 size={14} /> Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-5 bg-brand-card border-t border-brand-glass-border shadow-[0_-4px_15px_rgba(0,0,0,0.02)]">
              <div className="flex justify-between items-center mb-5 text-xl">
                  <div className="flex justify-between items-center text-sm font-bold text-brand-text/70">
                    <span>Subtotal</span>
                    <span>₹{cartTotal.toFixed(2)}</span>
                  </div>
                  {usePoints && discountAmount > 0 && (
                    <div className="flex justify-between items-center text-sm font-bold text-green-500">
                      <span>Loyalty Discount</span>
                      <span>-₹{discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  {taxRatePercentEstimate > 0 && (
                    <>
                      <div className="flex justify-between items-center text-sm font-bold text-brand-text/70">
                        <span>CGST ({(taxRatePercentEstimate / 2).toFixed(2)}%)</span>
                        <span>₹{cgstEstimate.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm font-bold text-brand-text/70">
                        <span>SGST ({(taxRatePercentEstimate / 2).toFixed(2)}%)</span>
                        <span>₹{sgstEstimate.toFixed(2)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between items-center text-xl font-black text-brand-text mt-2 pt-2 border-t border-brand-glass-border">
                    <span>Total</span>
                    <span className="text-brand-primary">₹{finalTotal.toFixed(2)}</span>
                  </div>
                </div>
                
                <button 
                  className="w-full mt-4 bg-brand-primary text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-brand-accent transition-colors shadow-lg shadow-brand-primary/20 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                  onClick={() => handleSave(false)}
                >
                  <Check size={20} />
                  {isSaving ? 'Saving...' : isEdit ? 'Update Order' : `Place Order (₹${finalTotal.toFixed(2)})`}
                </button>
            </div>
          </div>

        </div>
      </div>

      {/* Custom Item Modal */}
      {showCustomItem && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in p-4" onClick={() => setShowCustomItem(false)}>
          <div className="bg-brand-card w-full max-w-md p-6 lg:p-8 rounded-3xl shadow-2xl border border-brand-glass-border animate-slide-up flex flex-col gap-5" onClick={e => e.stopPropagation()}>
            <div className="text-center">
              <h3 className="text-2xl font-bold mb-1">Add Custom Item</h3>
              <p className="text-sm opacity-70">Enter details for the custom item</p>
            </div>
            
            <div className="flex flex-col gap-4 mt-2">
              <input 
                type="text" 
                placeholder="Item Name (e.g., Special Request)" 
                className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-3.5 text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-shadow"
                value={customItemName}
                onChange={e => setCustomItemName(e.target.value)}
                autoFocus
              />
              <input 
                type="number" 
                placeholder="Price" 
                className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-3.5 text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-shadow"
                value={customItemPrice}
                onChange={e => setCustomItemPrice(e.target.value)}
              />
              <input
                type="text"
                placeholder="Item Description / Notes"
                className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-3.5 text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-shadow"
                value={customItemNotes}
                onChange={e => setCustomItemNotes(e.target.value)}
              />
              <CategorySelect categories={menuCategories} value={customItemCategory} onChange={setCustomItemCategory} />
            </div>

            <div className="flex gap-3 mt-4 pt-4 border-t border-brand-glass-border/50">
              <button className="btn btn-secondary flex-1 py-3" onClick={() => { setShowCustomItem(false); setCustomItemCategory(''); }}>Cancel</button>
              <button className="btn btn-primary flex-1 py-3 shadow-lg" onClick={handleAddCustomItem}>Add to Order</button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}

export function BillModal({ order, menuItems, onClose, onMarkPaid, isMarkingPaid = false }) {
  // A settled order reprints from the breakdown stored at settle time; an open one starts
  // at zero. Previously the discount lived only in this component's state, so reopening a
  // paid bill showed no discount and a HIGHER total than the customer actually paid.
  const [discountValue, setDiscountValue] = useState(
    order.status === 'paid' && order.discount_value != null ? String(order.discount_value) : '0'
  );
  const [discountType, setDiscountType] = useState(order.discount_type || '%');
  // Split payment: which of the 3 methods are in use, and the typed amount for each.
  // Defaults to whichever method was picked when the order was placed (order.payment_method),
  // checked-and-blank, which auto-fills the full total below — same one-click speed as
  // before for the common (single-method) case. Previously this always defaulted to UPI
  // regardless of the order's chosen method, so a Cash/Card order left untouched at
  // checkout silently got recorded as a UPI payment.
  const initialMethodKey = (() => {
    const m = (order.payment_method || '').toLowerCase();
    if (m.includes('cash')) return 'cash';
    if (m.includes('card')) return 'card';
    return 'upi';
  })();
  const [enabledMethods, setEnabledMethods] = useState({
    cash: initialMethodKey === 'cash',
    upi: initialMethodKey === 'upi',
    card: initialMethodKey === 'card'
  });
  const [amounts, setAmounts] = useState({ cash: '', upi: '', card: '' });

  const activeItems = order.order_items?.filter(i => i.status !== 'cancelled') || [];

  // null (not 0) means the rate could not be determined at all — billing is blocked below
  // rather than silently issuing a 0% GST bill. 0 remains a valid zero-rated setting.
  const resolvedTaxRate = getTaxRatePercent();
  const isTaxRateKnown = resolvedTaxRate !== null;
  const taxRatePercent = resolvedTaxRate ?? 0;
  const gstin = readCache().gstin || '';

  // All bill math lives in src/lib/orderTotals.js so the screen, the printout, WhatsApp
  // and the dashboard cannot drift apart. grandTotal is the ROUNDED whole rupee, which is
  // what the split-payment autofill and the `remaining` check below settle against.
  const totals = {
    ...computeOrderTotals({ items: activeItems, discountType, discountValue, taxRatePercent }),
    discountType,
    discountValueRaw: parseFloat(discountValue) || 0,
  };
  const {
    subtotal, discountAmount, taxableValue,
    cgstAmount, sgstAmount, grandTotal, roundOff,
  } = totals;

  // A checked method left blank absorbs whatever's left of the total — so the common
  // case (one method covering the whole bill) still takes a single click. If more than
  // one checked method is blank, none are auto-filled (ambiguous) and the cashier has to
  // type at least one, at which point exactly one blank remains and the auto-fill kicks in.
  const checkedKeys = PAYMENT_METHODS.map(m => m.key).filter(k => enabledMethods[k]);
  const blankCheckedKeys = checkedKeys.filter(k => amounts[k].trim() === '');
  const typedTotal = checkedKeys.reduce((sum, k) => sum + (blankCheckedKeys.includes(k) ? 0 : (parseFloat(amounts[k]) || 0)), 0);
  const autoFillKey = blankCheckedKeys.length === 1 ? blankCheckedKeys[0] : null;
  const effectiveAmounts = Object.fromEntries(PAYMENT_METHODS.map(({ key }) => {
    if (!checkedKeys.includes(key)) return [key, 0];
    if (key === autoFillKey) return [key, Math.max(0, grandTotal - typedTotal)];
    return [key, parseFloat(amounts[key]) || 0];
  }));
  const splitTotal = Object.values(effectiveAmounts).reduce((a, b) => a + b, 0);
  const remaining = grandTotal - splitTotal;
  const isSplitValid = checkedKeys.length > 0 && Math.abs(remaining) < 0.01;

  const toggleMethod = (key) => {
    setEnabledMethods(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const paymentSummary = () => {
    const payingMethods = PAYMENT_METHODS.filter(m => checkedKeys.includes(m.key) && effectiveAmounts[m.key] > 0);
    if (payingMethods.length === 0) return 'Unpaid';
    if (payingMethods.length === 1) return payingMethods[0].label;
    return `Split: ${payingMethods.map(m => `${m.label} ₹${effectiveAmounts[m.key].toFixed(2)}`).join(' + ')}`;
  };

  const handleWhatsApp = () => {
    let phone = order.mobile_no || '';
    if (phone && phone.length === 10) phone = '91' + phone;

    const itemsText = activeItems.map(i => {
      const name = i.custom_name || menuItems.find(m => m.id === i.item_id)?.name || 'Item';
      return `${i.quantity}x ${name} - ₹${(i.price * i.quantity).toFixed(2)}`;
    }).join('\n');

    const msg = `Hi ${order.customer_name || 'there'},\nThank you for dining with Cielo Website!\n\nYour Bill for Table ${order.table_no}:\n${itemsText}\n\nSubtotal: ₹${subtotal.toFixed(2)}` +
      (discountAmount > 0 ? `\nDiscount (${discountType === '%' ? discountValue + '%' : 'Flat'}): -₹${discountAmount.toFixed(2)}` : '') +
      (taxRatePercent > 0 ? `\nCGST (${(taxRatePercent / 2).toFixed(2)}%): ₹${cgstAmount.toFixed(2)}\nSGST (${(taxRatePercent / 2).toFixed(2)}%): ₹${sgstAmount.toFixed(2)}` : '') +
      (roundOff !== 0 ? `\nRound Off: ${roundOff > 0 ? '+' : ''}₹${roundOff.toFixed(2)}` : '') +
      `\n*Grand Total: ₹${grandTotal.toFixed(2)}*\n\nPayment: ${paymentSummary()}`;

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handlePrint = () => {
    const shortId = order.order_number != null
      ? String(order.order_number).padStart(4, '0')
      : (parseInt(order.id.split('-')[0], 16) % 9000 + 1000).toLocaleString('en-US');

    // Load settings
    const defaultSettings = {
      print_business_name: 'CIELO cafe & resto',
      print_group_name: '(MIRA GROUP)',
      print_address_1: '6th floor, Asopalav One west, Sevasi -',
      print_address_2: 'Canal Rd , Vadodara, Gujarat 391101',
      print_phone: '9909377100',
      print_footer_1: 'THANK YOU...<br/>VISIT AGAIN...',
      print_footer_2: '\'Love our service? Leave us a quick<br/>review on google\'',
      print_logo_url: 'logo.png'
    };
    const savedSettings = JSON.parse(localStorage.getItem('print_settings') || '{}');
    const settings = { ...defaultSettings, ...savedSettings };
    
    const logoSrc = settings.print_logo_url || 'logo.png';

    const htmlContent = `
      <html>
        <head>
          <title>Bill - Table ${escapeHtml(order.table_no)}</title>
          <style>
            @page { margin: 0; size: 58mm auto; }
            body { margin: 0; padding: 0; font-family: Arial, sans-serif; font-size: 11px; color: black; background: white; width: 58mm; }
            .bill-container { width: 58mm; padding: 0 3mm; box-sizing: border-box; }
            .center { text-align: center; }
            .bold { font-weight: bold; }
            .line { border: none; border-top: 1px dashed black; margin: 6px 0; width: 100%; }
            .dotted-line { border: none; border-top: 1px dotted black; margin: 0; width: 100%; }
            .item-row { display: flex; justify-content: space-between; align-items: flex-start; font-size: 11px; padding: 1.5px 0; }
            .item-qty { width: 7mm; text-align: left; }
            .item-name { flex: 1; text-align: left; word-wrap: break-word; padding-right: 2mm; }
            .item-price { width: 11mm; text-align: right; white-space: nowrap; }
            .item-total { width: 13mm; text-align: right; white-space: nowrap; }
            .total-row { display: flex; justify-content: space-between; align-items: center; font-weight: bold; font-size: 13px; padding: 3px 0; }
            .footer { text-align: center; font-size: 11px; line-height: 1.5; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="bill-container">
            <div class="center" style="margin-bottom: 5px;">
              ${logoSrc ? `<img src="${logoSrc}" style="max-width: 150px; filter: grayscale(100%); margin-bottom: 4px;" onerror="this.style.display='none'" />` : ''}
              ${logoSrc ? '<br/>' : ''}
              <b style="font-size: 13px;">${escapeHtml(settings.print_business_name)}</b><br/>
              <span style="font-size: 11px;">${escapeHtml(settings.print_group_name)}</span>
            </div>
            <div class="center" style="font-size: 11px; line-height: 1.4; margin-bottom: 6px;">
              <br/>
              ${escapeHtml(settings.print_address_1)}<br/>
              ${escapeHtml(settings.print_address_2)}<br/>
              ${escapeHtml(settings.print_phone)}<br/>
              ${gstin ? `<b>GSTIN: ${escapeHtml(gstin)}</b><br/>` : ''}
              <b>Table: ${escapeHtml(order.table_no)}</b><br/>
              <b>Time: ${format(new Date(), 'd/M/yy HH:mm')}</b><br/>
              ${order.invoice_number != null
                ? `<b>Invoice No: INV-${String(order.invoice_number).padStart(4, '0')}</b><br/>`
                : ''}
              <b>Order Id: ${shortId}</b>
            </div>
            <hr class="line" />
            ${activeItems.map(item => {
              const name = item.custom_name || menuItems.find(m => m.id === item.item_id)?.name || 'Item';
              return `
              <div class="item-row">
                <span class="item-qty">${item.quantity}x</span>
                <span class="item-name">${escapeHtml(name)}</span>
                <span class="item-price">${item.price}</span>
                <span class="item-total">${(item.price * item.quantity).toFixed(2)}</span>
              </div>`;
            }).join('')}
            <hr class="line" />
            <div class="total-row" style="font-size: 11px; font-weight: normal;">
              <span>Subtotal</span>
              <span>Rs.${subtotal.toFixed(2)}</span>
            </div>
            ${discountAmount > 0 ? `
            <div class="total-row" style="font-size: 11px; font-weight: normal;">
              <span>Discount</span>
              <span>-Rs.${discountAmount.toFixed(2)}</span>
            </div>` : ''}
            ${taxRatePercent > 0 ? `
            <div class="total-row" style="font-size: 11px; font-weight: normal;">
              <span>CGST (${(taxRatePercent / 2).toFixed(2)}%)</span>
              <span>Rs.${cgstAmount.toFixed(2)}</span>
            </div>
            <div class="total-row" style="font-size: 11px; font-weight: normal;">
              <span>SGST (${(taxRatePercent / 2).toFixed(2)}%)</span>
              <span>Rs.${sgstAmount.toFixed(2)}</span>
            </div>` : ''}
            ${roundOff !== 0 ? `
            <div class="total-row" style="font-size: 11px; font-weight: normal;">
              <span>Round Off</span>
              <span>${roundOff > 0 ? '+' : ''}Rs.${roundOff.toFixed(2)}</span>
            </div>` : ''}
            <hr class="line" />
            <div class="total-row">
              <span>TOTAL</span>
              <span>Rs.${grandTotal.toFixed(2)}</span>
            </div>
            <div class="footer">
              <br/>
              ${settings.print_footer_1}<br/><br/>
              ${settings.print_footer_2}
            </div>
            <!-- Minimum 10 mm gap below where information ends -->
            <div style="height: 10mm;"></div>
            <!-- Dotted line stretched across the bill -->
            <hr class="dotted-line" />
            <!-- 20mm bottom feed so printer auto-advances past the cutter without cutting off information or the dotted line -->
            <div style="height: 20mm;"></div>
          </div>
        </body>
      </html>
    `;

    try {
      if (window.electronAPI) {
        window.electronAPI.printSilent(htmlContent);
      } else {
        throw new Error('electronAPI not available');
      }
    } catch (e) {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
      
      iframe.contentWindow.document.open();
      iframe.contentWindow.document.write(htmlContent);
      iframe.contentWindow.document.close();
      
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }
  };

  const handleClose = (e) => {
    e.stopPropagation();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center p-4" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
      <div className="bg-brand-card rounded-3xl shadow-2xl w-full max-w-105 flex flex-col overflow-hidden z-10 relative animate-slide-up text-brand-text" onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className="p-6 pb-2 text-center">
          <h3 className="text-xl font-black mb-1 text-brand-text">Table {order.table_no}</h3>
          <p className="text-sm text-brand-text/50 font-medium">{order.customer_name || 'Guest'}</p>
        </div>

        {/* Items */}
        <div className="px-6 py-4 max-h-[30vh] overflow-y-auto no-scrollbar border-b border-brand-glass-border">
          {activeItems.map(item => {
            const name = item.custom_name || menuItems.find(m => m.id === item.item_id)?.name || 'Item';
            return (
              <div key={item.id} className="flex justify-between items-start mb-3 last:mb-0 text-sm font-medium">
                <div className="flex gap-2">
                  <span className="text-brand-text/40">{item.quantity}×</span>
                  <span className="text-brand-text/80">{name}</span>
                </div>
                <span className="font-bold text-brand-text">₹{item.price * item.quantity}</span>
              </div>
            );
          })}
        </div>

        {/* Calculations */}
        <div className="p-6 bg-brand-secondary/10 space-y-4">
          <div className="flex justify-between items-center text-sm font-semibold">
            <span className="text-brand-text/60">Subtotal</span>
            <span className="text-brand-text">₹{subtotal.toFixed(0)}</span>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-sm font-semibold text-brand-text/60">Discount</span>
            <div className="flex items-center gap-3">
              <select
                className="bg-brand-bg border border-brand-glass-border rounded-lg py-1 px-2 text-sm font-bold text-brand-text focus:outline-none"
                value={discountType}
                onChange={e => setDiscountType(e.target.value)}
              >
                <option value="%">%</option>
                <option value="₹">₹</option>
              </select>
              <input 
                type="number" 
                className="w-16 text-center border border-brand-glass-border rounded-lg py-1 text-sm font-bold bg-brand-bg focus:outline-none focus:border-brand-primary text-brand-text"
                value={discountValue}
                onChange={e => setDiscountValue(e.target.value)}
              />
              <span className="text-sm font-bold text-red-500 w-16 text-right">-₹{discountAmount.toFixed(2)}</span>
            </div>
          </div>

          {taxRatePercent > 0 && (
            <>
              <div className="flex justify-between items-center text-sm font-semibold">
                <span className="text-brand-text/60">CGST ({(taxRatePercent / 2).toFixed(2)}%)</span>
                <span className="text-brand-text">₹{cgstAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-sm font-semibold">
                <span className="text-brand-text/60">SGST ({(taxRatePercent / 2).toFixed(2)}%)</span>
                <span className="text-brand-text">₹{sgstAmount.toFixed(2)}</span>
              </div>
            </>
          )}

          <div className="space-y-2">
            <span className="text-sm font-semibold text-brand-text/60">Payment</span>
            {PAYMENT_METHODS.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-3">
                <label className="flex items-center gap-2 w-32 shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded text-brand-primary bg-brand-bg border-brand-glass-border focus:ring-brand-primary"
                    checked={enabledMethods[key]}
                    onChange={() => toggleMethod(key)}
                  />
                  <span className="text-sm font-semibold text-brand-text">{label}</span>
                </label>
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text/40 text-sm">₹</span>
                  <input
                    type="number"
                    disabled={!enabledMethods[key]}
                    className="w-full bg-brand-bg border border-brand-glass-border rounded-lg py-1.5 pl-6 pr-3 text-sm font-bold text-brand-text focus:outline-none focus:border-brand-primary disabled:opacity-40"
                    placeholder={key === autoFillKey ? effectiveAmounts[key].toFixed(2) : '0.00'}
                    value={amounts[key]}
                    onChange={e => setAmounts(prev => ({ ...prev, [key]: e.target.value }))}
                  />
                </div>
              </div>
            ))}
            <div className="flex justify-between items-center text-sm font-bold pt-1">
              <span className="text-brand-text/60">Remaining</span>
              <span className={Math.abs(remaining) < 0.01 ? 'text-green-500' : 'text-red-500'}>₹{remaining.toFixed(2)}</span>
            </div>
          </div>

          {roundOff !== 0 && (
            <div className="flex justify-between items-center text-sm font-semibold">
              <span className="text-brand-text/60">Round Off</span>
              <span className="text-brand-text">{roundOff > 0 ? '+' : ''}₹{roundOff.toFixed(2)}</span>
            </div>
          )}

          <div className="pt-4 border-t border-brand-glass-border flex justify-between items-center mt-2">
            <span className="font-bold text-brand-text text-lg">Grand Total</span>
            <span className="font-black text-brand-primary text-2xl">₹{grandTotal.toFixed(2)}</span>
          </div>
        </div>

        {!isTaxRateKnown && (
          <div className="mx-5 mb-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm font-bold text-red-500 flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            GST rate unavailable — open Settings &gt; Tax &amp; Billing before billing this order.
          </div>
        )}

        {/* Actions */}
        <div className="p-5 flex flex-col gap-3 bg-brand-card">
          <div className="flex gap-3">
            <button className="flex-1 flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#128C7E] text-white font-bold py-3 rounded-xl transition-colors shadow-sm text-sm border border-[#1da851] disabled:opacity-40 disabled:cursor-not-allowed" disabled={!isTaxRateKnown} onClick={handleWhatsApp}>
              <MessageCircle size={16} /> WhatsApp
            </button>
            <button className="flex-1 flex items-center justify-center gap-2 bg-brand-secondary/30 hover:bg-brand-secondary/50 border border-brand-glass-border text-brand-text font-bold py-3 rounded-xl transition-colors shadow-sm text-sm disabled:opacity-40 disabled:cursor-not-allowed" disabled={!isTaxRateKnown} onClick={handlePrint}>
              <Printer size={16} className="text-brand-text/50" /> Print
            </button>
          </div>

          {order.status !== 'paid' && (
            <button
              disabled={isMarkingPaid || !isSplitValid || !isTaxRateKnown}
              className="w-full bg-[#1e40af] hover:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors shadow-md flex items-center justify-center gap-2 text-sm mt-1 border border-blue-400/30"
              onClick={(e) => {
                e.stopPropagation();
                onMarkPaid({
                  paid_cash: effectiveAmounts.cash,
                  paid_upi: effectiveAmounts.upi,
                  paid_card: effectiveAmounts.card,
                  summary: paymentSummary(),
                  totals
                });
              }}
            >
              <CheckCircle size={16} /> {isMarkingPaid ? 'Processing...' : isSplitValid ? 'Mark Paid & Complete' : `Remaining ₹${remaining.toFixed(2)}`}
            </button>
          )}
          
          <button className="w-full py-2.5 text-sm font-semibold text-brand-text/50 hover:text-brand-text border border-brand-glass-border rounded-xl hover:bg-brand-secondary/20 transition-colors mt-1" onClick={handleClose}>
            {order.status === 'paid' ? 'Close' : 'Cancel'}
          </button>
        </div>

      </div>
    </div>
  );
}

const MultiMergeConfirmationModal = ({ selectedIds, allOrders, onClose, onConfirm }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [primaryId, setPrimaryId] = useState(null);

  const ordersToMerge = allOrders.filter(o => selectedIds.includes(o.id));
  ordersToMerge.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Default to the first order until the user explicitly picks one — derived inline
  // instead of via effect+setState to avoid an extra cascading render on open.
  const effectivePrimaryId = primaryId ?? ordersToMerge[0]?.id ?? null;

  const targetOrder = ordersToMerge.find(o => o.id === effectivePrimaryId) || ordersToMerge[0];
  const sourceOrders = ordersToMerge.filter(o => o.id !== targetOrder?.id);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    await onConfirm(effectivePrimaryId);
    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-brand-card rounded-3xl shadow-xl w-[95%] sm:w-full max-w-125 flex flex-col max-h-[90vh] overflow-hidden z-10 relative">
        <div className="p-6 border-b border-brand-glass-border">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-black text-brand-text flex items-center gap-2">
              <GitMerge size={20} className="text-brand-primary" /> Confirm Merge
            </h3>
            <button onClick={onClose} className="text-brand-text/50 hover:text-brand-text">
              <X size={20} />
            </button>
          </div>
          <p className="text-sm font-medium text-brand-text/60 mt-2">
            Select the <span className="font-bold text-brand-text">Primary Order</span>. The other {sourceOrders.length} order(s) will be merged into it.
          </p>
        </div>

        <div className="p-6 overflow-y-auto bg-brand-bg/50 no-scrollbar flex-1 flex flex-col gap-3">
           <div className="text-sm font-bold text-brand-text/60 uppercase tracking-widest mb-1">Select Primary Order</div>
           {ordersToMerge.map(order => {
             const isPrimary = order.id === effectivePrimaryId;
             return (
               <div 
                 key={order.id} 
                 onClick={() => setPrimaryId(order.id)}
                 className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center justify-between gap-4 ${isPrimary ? 'border-brand-primary bg-brand-primary/5 shadow-sm' : 'border-brand-glass-border bg-brand-card hover:border-brand-primary/50 opacity-80 hover:opacity-100'}`}
               >
                  <div>
                    <div className="font-black text-brand-text text-lg">Table {order.table_no}</div>
                    <div className="text-xs font-medium text-brand-text/60">#{order.id.split('-')[0].toUpperCase()} • {order.customer_name || 'Guest'}</div>
                  </div>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                    isPrimary ? 'bg-brand-primary border-brand-primary' : 'border-brand-glass-border bg-brand-card'
                  }`}>
                    {isPrimary && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
               </div>
             )
           })}
        </div>

        <div className="p-4 bg-brand-card flex gap-3 border-t border-brand-glass-border">
          <button className="flex-1 py-4 text-brand-text font-bold bg-brand-card border border-brand-glass-border rounded-2xl hover:bg-brand-secondary transition-colors shadow-sm" onClick={onClose}>
            Cancel
          </button>
          <button 
            className="flex-2 py-4 text-white font-bold bg-brand-primary rounded-2xl hover:bg-brand-accent transition-colors shadow-md disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2" 
            disabled={isSubmitting || !effectivePrimaryId}
            onClick={handleConfirm}
          >
            {isSubmitting ? <RefreshCw className="animate-spin" size={18} /> : <GitMerge size={18} />} 
            Merge {sourceOrders.length} into Table {targetOrder?.table_no}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
