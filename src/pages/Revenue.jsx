import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { orderRevenue, isRevenueOrder } from '../lib/orderTotals';
import { billRow, groupByBusinessDay, PAYMENT_METHODS, UNPAID } from '../lib/dayReport';
import DateRangePicker, { DEFAULT_RANGE } from '../components/DateRangePicker';
import BillDetailModal from '../components/BillDetailModal';
import { businessDayStartUtc, todayBusinessDay } from '../lib/businessDay';
import { getTaxRatePercent } from '../lib/appSettings';
import { Search, Download, DollarSign, Calendar, Trophy, ChevronDown, Receipt, CalendarDays, List } from 'lucide-react';
import { format, startOfDay, startOfWeek, startOfMonth, parseISO } from 'date-fns';
import { logSupabaseRead } from '../lib/egressLogger';

// The three ways an owner asks about takings, and the view each one needs:
//   Bills    — "what did table 4 pay on Friday?"       → one row per bill, openable
//   Day-wise — "how did last week compare?"            → one row per business day
//   Items    — "how many cold coffees did we sell?"    → one row per line item
const VIEWS = [
  { key: 'bills', label: 'Bills', icon: Receipt },
  { key: 'days', label: 'Day-wise', icon: CalendarDays },
  { key: 'items', label: 'Items', icon: List },
];

export default function Revenue() {
  const [orders, setOrders] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(DEFAULT_RANGE);

  const [searchQuery, setSearchQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState('All Time');
  const [view, setView] = useState('bills');
  // A split bill matches every mode it used, so "Cash" finds a part-cash bill too.
  const [paymentFilter, setPaymentFilter] = useState('All Payments');
  const [selectedBill, setSelectedBill] = useState(null);

  const debounceRef = useRef(null);

  const fetchOrdersData = useCallback(async () => {
    // Bounded by the picked range, widened to cover the fixed Today/Week/Month cards.
    const monthStart = businessDayStartUtc(`${todayBusinessDay().slice(0, 7)}-01`).toISOString();
    const windowStart = range.fromUtc < monthStart ? range.fromUtc : monthStart;

    const { data: ordersData } = await supabase
      .from('orders')
      .select('id, created_at, customer_name, table_no, status, notes, order_number, invoice_number, grand_total, taxable_value, cgst_amount, sgst_amount, discount_amount, discount_type, discount_value, round_off, paid_cash, paid_upi, paid_card, payment_method, tax_rate_percent, order_items(id, order_id, item_id, custom_name, quantity, price, status, batch, created_at)')
      .gte('created_at', windowStart);

    if (ordersData) {
      logSupabaseRead('orders', 'Revenue fetchOrdersData', ordersData);
      setOrders(ordersData);
    }
    setLoading(false);
  }, [range.fromUtc]);

  const fetchMenuOnce = useCallback(async () => {
    const { data: menuData } = await supabase
      .from('menu_items')
      .select('id, name');
    if (menuData) {
      logSupabaseRead('menu_items', 'Revenue fetchMenuOnce', menuData);
      setMenuItems(menuData);
    }
  }, []);

  const debouncedFetchOrders = useCallback(() => {
    if (document.hidden) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchOrdersData();
    }, 3000);
  }, [fetchOrdersData]);

  useEffect(() => {
    fetchOrdersData();
    fetchMenuOnce();

    const ordersSub = supabase
      .channel('revenue_orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, debouncedFetchOrders)
      .subscribe();
      
    const orderItemsSub = supabase
      .channel('revenue_order_items')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, debouncedFetchOrders)
      .subscribe();

    const handleVisibilityChange = () => {
      if (!document.hidden) debouncedFetchOrders();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimeout(debounceRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      supabase.removeChannel(ordersSub);
      supabase.removeChannel(orderItemsSub);
    };
  }, [fetchOrdersData, fetchMenuOnce, debouncedFetchOrders]);

  // Separate from the subscription effect so changing the date doesn't re-open channels.
  useEffect(() => {
    fetchOrdersData();
  }, [range.fromUtc, range.toUtc, fetchOrdersData]);

  // --- Metrics Calculation ---
  // `endDate` is exclusive and optional — the fixed cards pass only a start, the range
  // picker passes both bounds.
  const calculateRevenue = (startDate = null, endDate = null) => {
    const filteredOrders = orders.filter(o => {
      if (!isRevenueOrder(o)) return false;
      const t = new Date(o.created_at);
      return (startDate === null || t >= startDate) && (endDate === null || t < endDate);
    });

    // Gross (what was actually collected, GST and discount included) via the shared helper.
    const rate = getTaxRatePercent() ?? 0;
    return filteredOrders.reduce((sum, order) => sum + orderRevenue(order, rate).gross, 0);
  };

  const revRange = calculateRevenue(new Date(range.fromUtc), new Date(range.toUtc));
  const revToday = calculateRevenue(startOfDay(new Date()));
  const revWeek = calculateRevenue(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const revMonth = calculateRevenue(startOfMonth(new Date()));

  const menuNameOf = (item) =>
    item.custom_name || menuItems.find(m => m.id === item.item_id)?.name || 'Unknown Item';

  // --- Bill-level rows (one per order) ---
  // Scoped to the picked range so this table always agrees with the "Selected Range" card
  // above it. All the money math is src/lib/dayReport.js, shared with Analytics and the KDS.
  const billRows = useMemo(() => {
    const rate = getTaxRatePercent() ?? 0;
    const from = new Date(range.fromUtc);
    const to = new Date(range.toUtc);
    const q = searchQuery.trim().toLowerCase();

    return orders
      .filter(o => {
        if (!isRevenueOrder(o)) return false;
        const t = new Date(o.created_at);
        return t >= from && t < to;
      })
      .map(o => billRow(o, rate))
      .filter(r => paymentFilter === 'All Payments' || r.paymentModes.includes(paymentFilter))
      .filter(r => {
        if (!q) return true;
        // Match the things a person actually searches a bill by.
        return [
          r.orderNumber != null ? String(r.orderNumber) : '',
          r.invoiceNumber != null ? `inv-${String(r.invoiceNumber).padStart(4, '0')}` : '',
          r.invoiceNumber != null ? String(r.invoiceNumber) : '',
          String(r.id).split('-')[0],
          r.customerName || '',
          r.tableNo != null ? `table ${r.tableNo}` : '',
        ].some(field => field.toLowerCase().includes(q));
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [orders, range.fromUtc, range.toUtc, searchQuery, paymentFilter]);

  // With a mode selected, the figure that matters is what came in THROUGH that mode —
  // a split bill's cash half, not its whole total. Unfiltered, it is the bill total.
  const billFilteredTotal = useMemo(() => billRows.reduce((sum, r) => {
    if (paymentFilter === 'All Payments' || paymentFilter === UNPAID) return sum + r.finalAmount;
    return sum + (r.collected > 0 ? r.payments[paymentFilter] : r.finalAmount);
  }, 0), [billRows, paymentFilter]);

  // --- Date-wise report (one row per business day) ---
  // Built from the unsearched bills: a day total that silently excluded the bills filtered
  // out by a search box would be a wrong number presented as a day's takings.
  const dayRows = useMemo(() => {
    const rate = getTaxRatePercent() ?? 0;
    const from = new Date(range.fromUtc);
    const to = new Date(range.toUtc);

    return groupByBusinessDay(
      orders
        .filter(o => {
          if (!isRevenueOrder(o)) return false;
          const t = new Date(o.created_at);
          return t >= from && t < to;
        })
        .map(o => billRow(o, rate))
    );
  }, [orders, range.fromUtc, range.toUtc]);

  const dayTotals = useMemo(() => dayRows.reduce((acc, d) => ({
    orders: acc.orders + d.orders,
    subtotal: acc.subtotal + d.subtotal,
    discount: acc.discount + d.discount,
    gst: acc.gst + d.gst,
    final: acc.final + d.final,
  }), { orders: 0, subtotal: 0, discount: 0, gst: 0, final: 0 }), [dayRows]);

  // --- Flattening Items for Table ---
  // We only include items from done/paid orders (or all active orders if you want to see pending too)
  // Let's show all active items from all orders so we can see the pipeline
  let flatItems = [];
  orders.forEach(order => {
    if (!order.order_items) return;
    
    order.order_items.forEach(item => {
      if (item.status === 'cancelled') return;
      
      const itemName = menuNameOf(item);

      flatItems.push({
        id: item.id,
        orderId: order.id,
        shortOrderId: order.id.split('-')[0].toUpperCase(),
        date: order.created_at,
        itemName: itemName,
        qty: item.quantity,
        unitPrice: item.price,
        total: item.price * item.quantity,
        status: order.status,
        payment: order.payment_method || 'Online/UPI'
      });
    });
  });

  // Sort by date descending
  flatItems.sort((a, b) => new Date(b.date) - new Date(a.date));

  // --- Filtering ---
  const filteredItems = flatItems.filter(item => {
    const d = new Date(item.date);
    
    // Time filter
    let timeMatch = true;
    if (timeFilter === 'Today') timeMatch = d >= startOfDay(new Date());
    else if (timeFilter === 'This Week') timeMatch = d >= startOfWeek(new Date(), { weekStartsOn: 1 });
    else if (timeFilter === 'This Month') timeMatch = d >= startOfMonth(new Date());
    
    // Search filter
    const searchMatch = item.itemName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        item.shortOrderId.toLowerCase().includes(searchQuery.toLowerCase());
                        
    return timeMatch && searchMatch;
  });

  // --- Export Excel ---
  // Exports the bills view in the same column layout as the reference Revenue Report
  // spreadsheet: Date | Order ID | Customer | Table | Status | Amount | Payment Method | Invoice
  // Invoice numbers are sequential (the gap-free invoice_number assigned by DB trigger).
  // For split payments the Payment Method cell shows "Split: Cash ₹X + UPI / Online ₹Y + Card ₹Z"
  // so it matches the format already used in the owner's reference file.

  /** Build a human-readable payment method string matching the reference spreadsheet format. */
  const formatPaymentMethod = (r) => {
    const modesWithAmount = Object.entries(r.payments).filter(([, amt]) => amt > 0);
    if (modesWithAmount.length === 0) {
      // Legacy / pre-split bill — fall back to status text
      return r.status === 'paid' ? 'Paid' : r.status;
    }
    if (modesWithAmount.length === 1) {
      return modesWithAmount[0][0]; // e.g. "Cash" or "UPI / Online"
    }
    // Split payment: "Split: Cash ₹500.00 + UPI / Online ₹254.00"
    return 'Split: ' + modesWithAmount.map(([name, amt]) => `${name} ₹${amt.toFixed(2)}`).join(' + ');
  };

  const CSV_VIEWS = {
    bills: () => ({
      name: 'Revenue_Report',
      // Columns match the reference spreadsheet exactly
      headers: ['Date', 'Order ID', 'Customer', 'Table', 'Status', 'Amount', 'Payment Method', 'Invoice'],
      // Sorted newest-first (same order as billRows); invoice number continues from last
      rows: billRows.map(r => [
        format(new Date(r.createdAt), 'dd/MM/yyyy HH:mm'),
        r.id,
        r.customerName ?? '',
        r.tableNo ? `T${r.tableNo}` : '',
        r.status,
        r.finalAmount,
        formatPaymentMethod(r),
        r.invoiceNumber ?? r.orderNumber ?? '',
      ]),
    }),
    days: () => ({
      name: 'day_wise',
      headers: ['Business Day', 'Bills', 'Subtotal', 'Discount', 'GST', 'Final Amount'],
      rows: dayRows.map(d => [d.day, d.orders, d.subtotal, d.discount, d.gst, d.final]),
    }),
    items: () => ({
      name: 'items',
      headers: ['Order #', 'Date', 'Item', 'Qty', 'Unit Price', 'Total', 'Payment', 'Status'],
      rows: filteredItems.map(item => [
        item.shortOrderId,
        format(new Date(item.date), 'yyyy-MM-dd HH:mm'),
        item.itemName,
        item.qty,
        item.unitPrice,
        item.total,
        item.payment,
        item.status,
      ]),
    }),
  };

  const exportToCSV = () => {
    const { name, headers, rows } = CSV_VIEWS[view]();

    if (rows.length === 0) {
      alert('No data to export!');
      return;
    }

    // Numbers stay unquoted so a spreadsheet reads them as numbers; text is quoted and
    // its own quotes doubled, since item names and customer names can contain commas.
    const cell = (v) => (typeof v === 'number' ? String(v) : `"${String(v ?? '').replace(/"/g, '""')}"`);
    const csvContent = [headers.join(','), ...rows.map(r => r.map(cell).join(','))].join('\n');

    // File name: Revenue_Report_YYYY-MM-DD.csv (matches the reference naming convention)
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${name}_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-brand-text/50">Loading revenue data...</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2">
        <div>
          <h1 className="text-3xl font-black text-brand-text mb-1 tracking-tight">Revenue</h1>
          <p className="text-brand-text/50 font-medium">Orders pulled from Supabase</p>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-2">
        
        {/* TODAY */}
        <div className="bg-brand-card rounded-xl border border-brand-glass-border overflow-hidden relative p-5 flex flex-col justify-between h-[120px]">
          <div className="absolute top-0 left-0 right-0 h-1 bg-green-500"></div>
          <div className="flex justify-between items-start">
            <div className="text-[10px] font-bold tracking-widest text-brand-text/50 uppercase">Today</div>
            <DollarSign size={16} className="text-brand-text/20" />
          </div>
          <div className="text-3xl font-black text-green-500 flex items-center">
            <span className="text-xl mr-1">₹</span>
            {revToday.toLocaleString('en-IN')}
          </div>
        </div>

        {/* THIS WEEK */}
        <div className="bg-brand-card rounded-xl border border-brand-glass-border overflow-hidden relative p-5 flex flex-col justify-between h-[120px]">
          <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500"></div>
          <div className="flex justify-between items-start">
            <div className="text-[10px] font-bold tracking-widest text-brand-text/50 uppercase">This Week</div>
            <Calendar size={16} className="text-brand-text/20" />
          </div>
          <div className="text-3xl font-black text-brand-text flex items-center">
            <span className="text-xl mr-1 opacity-70">₹</span>
            {revWeek.toLocaleString('en-IN')}
          </div>
        </div>

        {/* THIS MONTH */}
        <div className="bg-brand-card rounded-xl border border-brand-glass-border overflow-hidden relative p-5 flex flex-col justify-between h-[120px]">
          <div className="absolute top-0 left-0 right-0 h-1 bg-orange-500"></div>
          <div className="flex justify-between items-start">
            <div className="text-[10px] font-bold tracking-widest text-brand-text/50 uppercase">This Month</div>
            <Calendar size={16} className="text-brand-text/20" />
          </div>
          <div className="text-3xl font-black text-brand-text flex items-center">
            <span className="text-xl mr-1 opacity-70">₹</span>
            {revMonth.toLocaleString('en-IN')}
          </div>
        </div>

        {/* SELECTED RANGE — replaces the old All Time card, which required fetching the
            entire orders table on every load. An arbitrary range is strictly more useful. */}
        <div className="bg-brand-card rounded-xl border border-brand-glass-border overflow-hidden relative p-5 flex flex-col justify-between h-[120px]">
          <div className="absolute top-0 left-0 right-0 h-1 bg-purple-500"></div>
          <div className="flex justify-between items-start">
            <div className="text-[10px] font-bold tracking-widest text-brand-text/50 uppercase truncate pr-2">{range.label}</div>
            <Trophy size={16} className="text-brand-text/20 shrink-0" />
          </div>
          <div className="text-3xl font-black text-brand-text flex items-center">
            <span className="text-xl mr-1 opacity-70">₹</span>
            {revRange.toLocaleString('en-IN')}
          </div>
        </div>

      </div>

      <div className="mt-4">
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {/* Main Content Area (Filters + Table) */}
      <div className="glass p-6 rounded-2xl flex flex-col gap-6 border border-brand-glass-border flex-1">

        {/* View tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-brand-bg/60 border border-brand-glass-border w-fit">
          {VIEWS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                view === key
                  ? 'bg-brand-card text-brand-text shadow-sm border border-brand-glass-border'
                  : 'text-brand-text/50 hover:text-brand-text border border-transparent'
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {/* Filters Bar */}
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">

          {/* Search — the day-wise view has nothing per-row to search by. */}
          {view !== 'days' && (
            <div className="relative flex-1 max-w-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={16} className="text-brand-text/40" />
              </div>
              <input
                type="text"
                placeholder={view === 'bills' ? 'Search bill no, table or customer...' : 'Search items or order no...'}
                className="bg-brand-bg border border-brand-glass-border text-brand-text rounded-xl pl-10 pr-4 py-2.5 w-full focus:outline-none focus:border-brand-primary/50 transition-colors text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          )}

          {/* Payment mode — bills only. Day-wise shows per-day totals and Items shows
              line items, neither of which is a single payment. */}
          {view === 'bills' && (
            <div className="relative">
              <select
                aria-label="Filter by payment mode"
                className={`bg-brand-bg border text-brand-text font-medium text-sm rounded-xl pl-4 pr-10 py-2.5 appearance-none focus:outline-none transition-colors ${
                  paymentFilter === 'All Payments'
                    ? 'border-brand-glass-border focus:border-brand-primary/50'
                    : 'border-brand-primary/50 text-brand-primary font-bold'
                }`}
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
              >
                <option>All Payments</option>
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                <option value={UNPAID}>{UNPAID}</option>
              </select>
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <ChevronDown size={16} className="text-brand-text/40" />
              </div>
            </div>
          )}

          {/* Time Filter — only the item view has its own; bills and day-wise follow the
              date range above, so they always agree with the Selected Range card. */}
          {view === 'items' ? (
            <div className="relative">
              <select
                className="bg-brand-bg border border-brand-glass-border text-brand-text font-medium text-sm rounded-xl pl-4 pr-10 py-2.5 appearance-none focus:outline-none focus:border-brand-primary/50 transition-colors"
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value)}
              >
                <option>All Time</option>
                <option>This Month</option>
                <option>This Week</option>
                <option>Today</option>
              </select>
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <ChevronDown size={16} className="text-brand-text/40" />
              </div>
            </div>
          ) : (
            <div className="text-xs font-bold text-brand-text/40 flex-1">
              Showing {range.label}
              {/* With a mode selected the count and total are the answer to "how much
                  cash did we take this month", so show them rather than making the
                  owner add up the column. */}
              {view === 'bills' && paymentFilter !== 'All Payments' && (
                <span className="text-brand-primary ml-2">
                  · {billRows.length} {billRows.length === 1 ? 'bill' : 'bills'} · ₹{billFilteredTotal.toFixed(2)}
                </span>
              )}
            </div>
          )}

          {/* Export Excel */}
          <button
            className="btn bg-brand-bg border border-brand-glass-border hover:bg-brand-secondary text-brand-text font-bold text-sm px-4 py-2.5 transition-colors flex items-center gap-2 sm:ml-auto"
            onClick={exportToCSV}
          >
            <Download size={16} /> Export Excel
          </button>
        </div>

        {/* Bills — one row per order, click to see the full bill */}
        {view === 'bills' && (
          <div className="overflow-x-auto w-full -mx-6 px-6 sm:mx-0 sm:px-0 custom-scrollbar">
            <div className="overflow-y-auto max-h-[500px] w-full rounded-2xl border border-brand-glass-border custom-scrollbar relative">
              <table className="w-full border-collapse text-left min-w-[900px]">
                <thead className="sticky top-0 bg-brand-card z-10 shadow-sm">
                  <tr className="border-b border-brand-glass-border bg-brand-card/30">
                    <Th>Invoice</Th>
                    <Th>Order #</Th>
                    <Th>Date &amp; Time</Th>
                    <Th>Table / Customer</Th>
                    <Th className="text-right">Bill Amount</Th>
                    <Th className="text-right">Discount</Th>
                    <Th className="text-right">GST</Th>
                    <Th className="text-right">Final Amount</Th>
                    <Th>Payment</Th>
                  </tr>
                </thead>
                <tbody>
                  {billRows.map(r => (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedBill(r)}
                      title="View bill details"
                      className="border-b border-brand-glass-border/50 hover:bg-brand-secondary/20 transition-colors cursor-pointer"
                    >
                      <td className="p-4 font-mono text-xs font-black text-brand-primary whitespace-nowrap">
                        {r.invoiceNumber != null ? `INV-${String(r.invoiceNumber).padStart(4, '0')}` : <span className="text-brand-text/30 font-medium">—</span>}
                      </td>
                      <td className="p-4 text-brand-text/60 font-mono text-xs font-bold">
                        {r.orderNumber != null ? `#${r.orderNumber}` : String(r.id).split('-')[0].toUpperCase()}
                      </td>
                      <td className="p-4 text-brand-text/70 text-sm font-medium whitespace-nowrap">
                        {format(new Date(r.createdAt), 'dd MMM yyyy')}
                        <span className="text-brand-text/40 ml-2 text-xs">{format(new Date(r.createdAt), 'h:mm a')}</span>
                      </td>
                      <td className="p-4 text-sm font-semibold text-brand-text">
                        {r.tableNo ? `Table ${r.tableNo}` : '—'}
                        {r.customerName && <span className="text-brand-text/40 font-medium ml-2 text-xs">{r.customerName}</span>}
                      </td>
                      <td className="p-4 text-brand-text/70 text-sm text-right whitespace-nowrap">₹{r.subtotal.toFixed(2)}</td>
                      <td className={`p-4 text-sm text-right whitespace-nowrap ${r.discountAmount > 0 ? 'text-red-500 font-bold' : 'text-brand-text/30'}`}>
                        {r.discountAmount > 0 ? `−₹${r.discountAmount.toFixed(2)}` : '—'}
                      </td>
                      <td className="p-4 text-brand-text/50 text-sm text-right whitespace-nowrap">₹{r.gstAmount.toFixed(2)}</td>
                      <td className="p-4 font-black text-sm text-brand-text text-right whitespace-nowrap">₹{r.finalAmount.toFixed(2)}</td>
                      <td className="p-4">
                        <PaymentChips payments={r.payments} fallback={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {billRows.length === 0 && <EmptyState label="No bills in this period" />}
          </div>
        )}

        {/* Day-wise revenue report */}
        {view === 'days' && (
          <div className="overflow-x-auto w-full -mx-6 px-6 sm:mx-0 sm:px-0 custom-scrollbar">
            <div className="overflow-y-auto max-h-[500px] w-full rounded-2xl border border-brand-glass-border custom-scrollbar relative">
              <table className="w-full border-collapse text-left min-w-[700px]">
                <thead className="sticky top-0 bg-brand-card z-10 shadow-sm">
                  <tr className="border-b border-brand-glass-border bg-brand-card/30">
                    <Th>Date</Th>
                    <Th className="text-right">Bills</Th>
                    <Th className="text-right">Bill Amount</Th>
                    <Th className="text-right">Discount</Th>
                    <Th className="text-right">GST</Th>
                    <Th className="text-right">Final Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map(d => (
                    <tr key={d.day} className="border-b border-brand-glass-border/50 hover:bg-brand-secondary/20 transition-colors">
                      <td className="p-4 text-sm font-bold text-brand-text whitespace-nowrap">
                        {format(parseISO(`${d.day}T00:00:00`), 'dd MMM yyyy')}
                        <span className="text-brand-text/40 font-medium ml-2 text-xs">
                          {format(parseISO(`${d.day}T00:00:00`), 'EEE')}
                        </span>
                      </td>
                      <td className="p-4 text-brand-text/70 text-sm text-right font-bold">{d.orders}</td>
                      <td className="p-4 text-brand-text/70 text-sm text-right whitespace-nowrap">₹{d.subtotal.toFixed(2)}</td>
                      <td className={`p-4 text-sm text-right whitespace-nowrap ${d.discount > 0 ? 'text-red-500 font-bold' : 'text-brand-text/30'}`}>
                        {d.discount > 0 ? `−₹${d.discount.toFixed(2)}` : '—'}
                      </td>
                      <td className="p-4 text-brand-text/50 text-sm text-right whitespace-nowrap">₹{d.gst.toFixed(2)}</td>
                      <td className="p-4 font-black text-sm text-green-500 text-right whitespace-nowrap">₹{d.final.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                {dayRows.length > 0 && (
                  <tfoot className="sticky bottom-0 bg-brand-card">
                    <tr className="border-t-2 border-brand-glass-border">
                      <td className="p-4 text-xs font-black uppercase tracking-widest text-brand-text/60">Total</td>
                      <td className="p-4 text-sm text-right font-black text-brand-text">{dayTotals.orders}</td>
                      <td className="p-4 text-sm text-right font-bold text-brand-text whitespace-nowrap">₹{dayTotals.subtotal.toFixed(2)}</td>
                      <td className="p-4 text-sm text-right font-bold text-red-500 whitespace-nowrap">−₹{dayTotals.discount.toFixed(2)}</td>
                      <td className="p-4 text-sm text-right font-bold text-brand-text/60 whitespace-nowrap">₹{dayTotals.gst.toFixed(2)}</td>
                      <td className="p-4 text-base text-right font-black text-green-500 whitespace-nowrap">₹{dayTotals.final.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {dayRows.length === 0 && <EmptyState label="No trade in this period" />}
          </div>
        )}

        {/* Items — the original line-item table */}
        {view === 'items' && (
        <div className="overflow-x-auto w-full -mx-6 px-6 sm:mx-0 sm:px-0 custom-scrollbar">
          <div className="overflow-y-auto max-h-[500px] w-full rounded-2xl border border-brand-glass-border custom-scrollbar relative">
            <table className="w-full border-collapse text-left min-w-[800px]">
              <thead className="sticky top-0 bg-brand-card z-10 shadow-sm">
              <tr className="border-b border-brand-glass-border bg-brand-card/30">
                <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px]">#</th>
                <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px]">Date</th>
                <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px]">Item</th>
                <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px]">Qty</th>
                <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px]">Unit Price</th>
                <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px]">Total</th>
                <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px]">Payment</th>
                <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px]">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id} className="border-b border-brand-glass-border/50 hover:bg-brand-secondary/20 transition-colors">
                  <td className="p-4 text-brand-text/40 font-mono text-xs font-bold">{item.shortOrderId}</td>
                  <td className="p-4 text-brand-text/70 text-sm font-medium">{format(new Date(item.date), 'dd MMM yyyy')}</td>
                  <td className="p-4 font-bold text-sm text-brand-text">{item.itemName}</td>
                  <td className="p-4 text-brand-text/80 text-sm font-bold">x{item.qty}</td>
                  <td className="p-4 text-brand-text/60 text-sm">₹{item.unitPrice.toFixed(2)}</td>
                  <td className="p-4 font-black text-sm text-brand-text">₹{item.total.toFixed(2)}</td>
                  <td className="p-4 text-brand-text/70 text-xs font-semibold">{item.payment}</td>
                  <td className="p-4">
                    <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                      item.status === 'pending' ? 'bg-red-500/10 text-red-500' :
                      item.status === 'paid' ? 'bg-blue-500/10 text-blue-500' :
                      'bg-green-500/10 text-green-500'
                    }`}>
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          
          {filteredItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 bg-brand-secondary/20 rounded-full flex items-center justify-center mb-4 text-[#d97706]">
                <DollarSign size={24} />
              </div>
              <h3 className="text-lg font-bold text-brand-text mb-1">No orders found</h3>
              <p className="text-brand-text/50 text-sm">No items match your current filters.</p>
            </div>
          )}
        </div>
        )}

      </div>

      {selectedBill && (
        <BillDetailModal
          row={selectedBill}
          itemName={menuNameOf}
          onClose={() => setSelectedBill(null)}
        />
      )}

    </div>
  );
}

// Shared table header cell — the same eight utility classes were repeated on every column.
function Th({ children, className = '' }) {
  return (
    <th className={`p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px] ${className}`}>
      {children}
    </th>
  );
}

// How a bill was settled, at a glance. A bill with nothing in the split columns predates
// them, so its status is shown instead of inventing a payment mode.
function PaymentChips({ payments, fallback }) {
  const paid = Object.entries(payments).filter(([, amount]) => amount > 0);
  if (paid.length === 0) {
    return <span className="text-[10px] font-bold uppercase tracking-wider text-brand-text/40">{fallback}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {paid.map(([name, amount]) => (
        <span
          key={name}
          className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-brand-secondary/40 text-brand-text/70 whitespace-nowrap"
          title={`₹${amount.toFixed(2)}`}
        >
          {name === 'UPI / Online' ? 'UPI' : name}
        </span>
      ))}
    </div>
  );
}

function EmptyState({ label }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 bg-brand-secondary/20 rounded-full flex items-center justify-center mb-4 text-[#d97706]">
        <DollarSign size={24} />
      </div>
      <h3 className="text-lg font-bold text-brand-text mb-1">{label}</h3>
      <p className="text-brand-text/50 text-sm">Try a different date range.</p>
    </div>
  );
}
