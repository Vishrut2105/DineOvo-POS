import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { daySummary, PAYMENT_METHODS, UNPAID } from '../lib/dayReport';
import { businessDayRangeUtc, todayBusinessDay, addDays, BUSINESS_DAY_START_HOUR } from '../lib/businessDay';
import { getTaxRatePercent } from '../lib/appSettings';
import { Banknote, Smartphone, CreditCard, ChevronLeft, ChevronRight, Wallet, Receipt, TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';

// "Summary of the Day" — the closing-time view: how the day was paid for, what went out,
// and what is actually left. Deliberately scoped to ONE business day and given its own
// date control, because the question it answers ("does the till match?") is a per-day
// question; the rest of the Analytics page works over a range.
//
// All the arithmetic lives in src/lib/dayReport.js so this page and the Revenue page
// cannot disagree about the same day's takings.

const METHOD_ICONS = {
  'Cash': Banknote,
  'UPI / Online': Smartphone,
  'Card': CreditCard,
  [UNPAID]: Clock,
};

const METHOD_COLORS = {
  'Cash': 'text-emerald-500',
  'UPI / Online': 'text-blue-500',
  'Card': 'text-purple-500',
  [UNPAID]: 'text-amber-500',
};

const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// `day`/`onDayChange` are optional: pass them to keep the chosen date alive across a
// parent re-render that unmounts this card (the Analytics page blanks itself while a new
// range loads, which otherwise silently snapped the selection back to today).
export default function DaySummary({ day: controlledDay, onDayChange }) {
  const [ownDay, setOwnDay] = useState(() => todayBusinessDay());
  const day = controlledDay ?? ownDay;
  const setDay = onDayChange ?? setOwnDay;
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);

  const today = todayBusinessDay();
  const isToday = day === today;

  useEffect(() => {
    let cancelled = false;

    const fetchDay = async () => {
      setLoading(true);
      // A single business day: 05:00 IST on `day` up to (not including) 05:00 the next
      // morning, so a 1am order counts against the night it was served.
      const { fromUtc, toUtc } = businessDayRangeUtc(day, day);

      const [ordersRes, expensesRes] = await Promise.all([
        supabase.from('orders').select('id, order_number, invoice_number, created_at, customer_name, table_no, status, grand_total, discount_amount, discount_type, discount_value, taxable_value, cgst_amount, sgst_amount, round_off, paid_cash, paid_upi, paid_card, payment_method, tax_rate_percent, order_items(id, status, quantity, price, custom_name, item_id)').gte('created_at', fromUtc).lt('created_at', toUtc),
        supabase.from('expenses').select('amount, date, description, category').gte('date', fromUtc).lt('date', toUtc),
      ]);

      if (cancelled) return;
      setRaw({ orders: ordersRes.data || [], expenses: expensesRes.data || [] });
      setLoading(false);
    };

    fetchDay();
    return () => { cancelled = true; };
  }, [day]);

  const summary = useMemo(() => {
    if (!raw) return null;
    return daySummary({
      orders: raw.orders,
      expenses: raw.expenses,
      taxRatePercent: getTaxRatePercent() ?? 0,
    });
  }, [raw]);

  // Payment rows always list every mode, including the ones that took nothing — a zero
  // against Card is information ("no card sales today"), a missing row is ambiguous.
  const paymentRows = useMemo(() => {
    const found = new Map((summary?.payments || []).map(p => [p.name, p]));
    const rows = PAYMENT_METHODS.map(name => found.get(name) || { name, amount: 0, orders: 0 });
    // Unpaid is the remainder, not a mode — shown only when it is non-zero, and last.
    if (found.has(UNPAID)) rows.push(found.get(UNPAID));
    return rows;
  }, [summary]);

  return (
    <div className="bg-brand-card rounded-2xl border border-brand-glass-border shadow-sm p-5 flex flex-col gap-5">

      {/* Header + day picker */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-brand-text/80">Summary of the Day</h3>
          <p className="text-[11px] font-medium text-brand-text/40 mt-0.5">
            {format(parseISO(`${day}T00:00:00`), 'EEEE, d MMMM yyyy')}
            {isToday && <span className="ml-1.5 text-brand-primary font-bold">· Today</span>}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => setDay(d => addDays(d, -1))}
            className="p-2 rounded-lg text-brand-text/60 hover:bg-brand-secondary/40 hover:text-brand-text transition-colors border border-brand-glass-border"
          >
            <ChevronLeft size={14} />
          </button>

          <input
            type="date"
            value={day}
            max={today}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            aria-label="Select a date"
            className="bg-brand-bg border border-brand-glass-border text-brand-text text-xs font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary/50 transition-colors"
          />

          <button
            type="button"
            aria-label="Next day"
            // Can't run past today — there is no trade to summarise in the future.
            disabled={isToday}
            onClick={() => setDay(d => addDays(d, 1))}
            className="p-2 rounded-lg text-brand-text/60 hover:bg-brand-secondary/40 hover:text-brand-text transition-colors border border-brand-glass-border disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <ChevronRight size={14} />
          </button>

          {!isToday && (
            <button
              type="button"
              onClick={() => setDay(today)}
              className="px-3 py-2 rounded-lg text-[11px] font-bold text-brand-primary border border-brand-primary/30 bg-brand-primary/10 hover:bg-brand-primary/20 transition-colors"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {loading || !summary ? (
        <div className="h-48 flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-brand-primary"></div>
        </div>
      ) : summary.orderCount === 0 ? (
        <div className="h-48 flex flex-col items-center justify-center text-center gap-2">
          <div className="w-12 h-12 rounded-full bg-brand-secondary/30 flex items-center justify-center">
            <Receipt size={20} className="text-brand-text/40" />
          </div>
          <p className="text-sm font-bold text-brand-text">No settled bills on this day</p>
          <p className="text-xs text-brand-text/50">
            A day runs {BUSINESS_DAY_START_HOUR}:00 AM to {BUSINESS_DAY_START_HOUR}:00 AM, so late-night
            orders count toward the night they were served.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Payment mode summary */}
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-brand-text/40 mb-1">
              Payment Modes
            </div>

            {paymentRows.map(row => {
              const Icon = METHOD_ICONS[row.name] || Wallet;
              const share = summary.grossRevenue > 0 ? (row.amount / summary.grossRevenue) * 100 : 0;
              return (
                <div
                  key={row.name}
                  className={`flex items-center gap-3 p-3 rounded-xl border ${row.isUnpaid ? 'border-amber-500/40 bg-amber-500/5' : 'border-brand-glass-border'} ${row.amount > 0 ? (row.isUnpaid ? '' : 'bg-brand-bg/50') : 'bg-transparent opacity-50'}`}
                >
                  <Icon size={18} className={METHOD_COLORS[row.name] || 'text-brand-text/50'} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-brand-text">{row.name}</div>
                    <div className="text-[10px] font-medium text-brand-text/40">
                      {row.orders} {row.orders === 1 ? 'bill' : 'bills'} · {share.toFixed(0)}%
                    </div>
                  </div>
                  <div className="text-sm font-black text-brand-text whitespace-nowrap">{rupees(row.amount)}</div>
                </div>
              );
            })}

            <div className="flex flex-col gap-1 px-3 pt-2 mt-1 border-t border-brand-glass-border">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-brand-text/60 uppercase tracking-wider">Total Collection</span>
                <span className="text-lg font-black text-brand-text">{rupees(summary.totalCollection)}</span>
              </div>
              {summary.unpaidAmount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">+ Not yet paid</span>
                  <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{rupees(summary.unpaidAmount)}</span>
                </div>
              )}
              {/* The check the owner can do by eye: this line must equal Gross revenue opposite. */}
              <div className="flex items-center justify-between pt-1 border-t border-dashed border-brand-glass-border">
                <span className="text-[10px] font-bold uppercase tracking-widest text-brand-text/40">= Gross revenue</span>
                <span className="text-sm font-black text-brand-text/70">{rupees(summary.totalCollection + summary.unpaidAmount)}</span>
              </div>
            </div>
          </div>

          {/* Day-end figures */}
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-brand-text/40 mb-1">
              Day End
            </div>

            <SummaryLine label="Bills settled" value={String(summary.orderCount)} />
            <SummaryLine label="Gross revenue (incl. GST)" value={rupees(summary.grossRevenue)} />
            <SummaryLine label="Discount given" value={`− ${rupees(summary.totalDiscount)}`} tone="text-red-500" />
            {/* GST is collected for the government, so it is shown but never counted as income. */}
            <SummaryLine label="GST collected" value={rupees(summary.gstCollected)} tone="text-brand-text/60" />
            <SummaryLine label="Net revenue (excl. GST)" value={rupees(summary.netRevenue)} />
            <SummaryLine label="Total expenses" value={`− ${rupees(summary.totalExpenses)}`} tone="text-red-500" />

            <div className={`flex items-center justify-between p-4 rounded-xl mt-1 border ${
              summary.dayEndRevenue >= 0
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-red-500/10 border-red-500/30'
            }`}>
              <div className="flex items-center gap-2">
                {summary.dayEndRevenue >= 0
                  ? <TrendingUp size={16} className="text-emerald-500" />
                  : <TrendingDown size={16} className="text-red-500" />}
                <span className="text-xs font-bold text-brand-text uppercase tracking-wider">Day-End Revenue</span>
              </div>
              <span className={`text-xl font-black ${summary.dayEndRevenue >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {rupees(summary.dayEndRevenue)}
              </span>
            </div>
            <p className="text-[10px] font-medium text-brand-text/40 px-1">
              Net revenue less expenses. GST is excluded — it is collected on the government's behalf,
              not earned.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryLine({ label, value, tone = 'text-brand-text' }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-brand-secondary/20 transition-colors">
      <span className="text-xs font-medium text-brand-text/60">{label}</span>
      <span className={`text-sm font-bold ${tone}`}>{value}</span>
    </div>
  );
}
