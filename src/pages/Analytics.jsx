import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { orderRevenue, orderLostRevenue, isRevenueOrder } from '../lib/orderTotals';
import { DollarSign, ShoppingBag, TrendingUp, TrendingDown, PackageOpen, LayoutDashboard, Clock, Activity, CreditCard } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie, Legend
} from 'recharts';
import { format, parseISO } from 'date-fns';
import DateRangePicker, { DEFAULT_RANGE } from '../components/DateRangePicker';
import DaySummary from '../components/DaySummary';
import { paymentBreakdown, itemRevenueLines } from '../lib/dayReport';
import { businessDayOf, eachBusinessDay, todayBusinessDay, BUSINESS_DAY_START_HOUR } from '../lib/businessDay';

export default function Analytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(DEFAULT_RANGE);
  // Held here rather than inside DaySummary: this page blanks itself while a new range
  // loads, unmounting that card, which would otherwise reset the chosen day to today.
  const [summaryDay, setSummaryDay] = useState(() => todayBusinessDay());

  useEffect(() => {
    fetchData();
  }, [range.fromUtc, range.toUtc]);

  const fetchData = async () => {
    setLoading(true);
    // Bounded on both ends: toUtc is the instant the day AFTER the range begins, so an
    // order can never be counted in two adjacent ranges.
    const { fromUtc, toUtc } = range;

    const [ordersRes, expensesRes, menuRes, invRes, taxRes] = await Promise.all([
      supabase.from('orders').select('*, order_items(*)').gte('created_at', fromUtc).lt('created_at', toUtc),
      supabase.from('expenses').select('*').gte('date', fromUtc).lt('date', toUtc),
      supabase.from('menu_items').select('id, name, category'),
      supabase.from('inventory').select('*'),
      supabase.from('app_settings').select('value').eq('key', 'tax_rate').maybeSingle()
    ]);

    // Data Processing inside useMemo-like logic (we just set raw data into state and compute inside component)
    setData({
      orders: ordersRes.data || [],
      expenses: expensesRes.data || [],
      menuItems: menuRes.data || [],
      inventory: invRes.data || [],
      taxRatePercent: parseFloat(taxRes.data?.value) || 0
    });
    setLoading(false);
  };

  const metrics = useMemo(() => {
    if (!data) return null;
    const { orders, expenses, menuItems, inventory, taxRatePercent } = data;

    // Base Maps
    const menuMap = {};
    const menuNameMap = {};
    menuItems.forEach(m => {
        menuMap[m.id] = m.category || 'Uncategorized';
        menuNameMap[m.id] = m.name || 'Unknown Item';
    });

    // 1. Totals — all revenue math comes from src/lib/orderTotals.js so this page, the
    // bill, and every other report agree on what an order was worth.
    let totalRevenue = 0;            // gross, GST included
    let totalRevenueWithoutGst = 0;  // net of GST
    let totalLostRevenue = 0;
    orders.forEach(o => {
        totalLostRevenue += orderLostRevenue(o);
        // Settled orders only — this page used to count unpaid `pending` orders as revenue,
        // which is why its total never matched the Dashboard or the Revenue page.
        if (!isRevenueOrder(o)) return;
        const { gross, net } = orderRevenue(o, taxRatePercent);
        totalRevenue += gross;
        totalRevenueWithoutGst += net;
    });
    const totalExpensesAmount = expenses.reduce((sum, exp) => sum + Number(exp.amount), 0);
    // Profit excludes GST — it's tax collected on the government's behalf, not income.
    const netProfit = totalRevenueWithoutGst - totalExpensesAmount;

    // 2. Trend Data — one bucket per BUSINESS day in the selected range, so a late-night
    // order lands on the night it was served rather than the following morning.
    //
    // A single-day range has only one daily bucket, which drew a chart with one point and
    // no line at all. For one day we bucket BY HOUR instead, which is what you actually
    // want to see for a single day's trade anyway.
    const days = eachBusinessDay(range.from, range.to);
    const isSingleDay = days.length === 1;

    const trendsMap = {};
    if (isSingleDay) {
        // Business day runs 5am -> 5am, so the hours run 5,6,...,23,0,...,4 in order.
        for (let i = 0; i < 24; i++) {
          const h = (BUSINESS_DAY_START_HOUR + i) % 24;
          trendsMap[h] = {
            date: `${String(h).padStart(2, '0')}:00`,
            revenue: 0, lostRevenue: 0, expenses: 0, profit: 0
          };
        }
    } else {
        for (const day of days) {
          trendsMap[day] = {
            date: format(parseISO(`${day}T00:00:00`), 'MMM dd'),
            revenue: 0, lostRevenue: 0, expenses: 0, profit: 0
          };
        }
    }

    // IST wall-clock hour of a timestamp, for the single-day view.
    const istHour = (ts) => new Date(new Date(ts).getTime() + (5 * 60 + 30) * 60000).getUTCHours();
    const bucketKey = (ts) => (isSingleDay ? istHour(ts) : businessDayOf(ts));

    orders.forEach(o => {
       const key = bucketKey(o.created_at);
       if (trendsMap[key]) {
          trendsMap[key].lostRevenue += orderLostRevenue(o);
          if (isRevenueOrder(o)) {
             const { gross, net } = orderRevenue(o, taxRatePercent);
             // The Revenue line matches the headline Revenue card (gross, GST included);
             // profit is built from net, since GST collected is not income.
             trendsMap[key].revenue += gross;
             trendsMap[key].profit += net;
          }
       }
    });
    expenses.forEach(e => {
       const key = bucketKey(e.date);
       if (trendsMap[key]) {
          const amt = Number(e.amount) || 0;
          trendsMap[key].expenses += amt;
          trendsMap[key].profit -= amt;
       }
    });
    // Object key order is insertion order for the day view, but numeric-string keys sort
    // themselves in JS — so the hourly view is rebuilt explicitly in 5am-first order.
    const trendData = isSingleDay
      ? Array.from({ length: 24 }, (_, i) => trendsMap[(BUSINESS_DAY_START_HOUR + i) % 24])
      : Object.values(trendsMap);

    // Every breakdown below reports on trade that was actually settled. Counting `pending`
    // orders here was the same defect the payment panel had: an abandoned or never-paid
    // bill was reported as a table's takings, a category's revenue and a top seller.
    const settledOrders = orders.filter(isRevenueOrder);

    // 3. Peak Hours — order volume, so cancelled orders are excluded but unpaid ones still
    // count (the kitchen did the work either way).
    //
    // Bucketed by IST via the helper above, NOT by `new Date(...).getHours()`: that reads
    // the terminal's own timezone, so on any machine not set to IST this chart silently
    // slid hours away from the trend chart directly beside it.
    const hoursMap = Array(24).fill(0).map((_, i) => ({ hour: `${i}:00`, orders: 0 }));
    orders.forEach(o => {
        if (o.status === 'cancelled') return;
        hoursMap[istHour(o.created_at)].orders += 1;
    });
    const peakHoursData = hoursMap;

    // 4. Top Items — quantity at menu price, revenue net of the bill's discount.
    const itemSales = {};
    settledOrders.forEach(o => {
       itemRevenueLines(o, taxRatePercent).forEach(({ item, net }) => {
           const itemName = item.custom_name || menuNameMap[item.item_id] || 'Unknown Item';
           if (!itemSales[itemName]) itemSales[itemName] = { name: itemName, qty: 0, revenue: 0 };
           itemSales[itemName].qty += item.quantity;
           itemSales[itemName].revenue += net;
       });
    });
    const topItems = Object.values(itemSales).sort((a,b) => b.qty - a.qty).slice(0, 5);

    // 5. Top Tables
    const tableSales = {};
    settledOrders.forEach(o => {
       if(!o.table_no) return;
       const rev = itemRevenueLines(o, taxRatePercent).reduce((sum, l) => sum + l.net, 0);
       if (!tableSales[o.table_no]) tableSales[o.table_no] = { name: `Table ${o.table_no}`, revenue: 0 };
       tableSales[o.table_no].revenue += rev;
    });
    const topTables = Object.values(tableSales).sort((a,b) => b.revenue - a.revenue).slice(0, 5);

    // 6. Category Revenue — these slices now sum to "Revenue (without GST)". Previously
    // they summed to gross menu value of every order ever placed, so the pie total could
    // exceed the revenue card sitting above it.
    const catSales = {};
    settledOrders.forEach(o => {
       itemRevenueLines(o, taxRatePercent).forEach(({ item, net }) => {
           const cat = menuMap[item.item_id] || 'Uncategorized';
           if (!catSales[cat]) catSales[cat] = { name: cat, value: 0 };
           catSales[cat].value += net;
       });
    });
    const catData = Object.values(catSales).filter(c => c.value > 0).sort((a,b) => b.value - a.value);

    // 7. Payment Methods — settled orders only, via the shared breakdown in
    // src/lib/dayReport.js. This page used to attribute every order to a payment mode,
    // including `pending` ones nobody had paid for, so the default 'Online / UPI' column
    // was inflated with money that had never been taken.
    // Paid modes first by size; the unpaid line always last so it reads as the remainder.
    const payData = paymentBreakdown(orders, taxRatePercent)
       .map(p => ({ name: p.name, value: p.amount, orders: p.orders, isUnpaid: p.isUnpaid }))
       .sort((a, b) => (a.isUnpaid - b.isUnpaid) || (b.value - a.value));
    const payTotal = payData.reduce((s, p) => s + p.value, 0);

    // 8. Inventory Status
    let inStock = 0, lStock = 0, oStock = 0;
    inventory.forEach(inv => {
       if (inv.quantity <= 0) oStock++;
       else if (inv.quantity <= (inv.min_stock || 0)) lStock++;
       else inStock++;
    });
    const invData = [
       { name: 'Healthy', value: inStock, color: '#10b981' },
       { name: 'Low Stock', value: lStock, color: '#f59e0b' },
       { name: 'Out of Stock', value: oStock, color: '#ef4444' }
    ].filter(i => i.value > 0);

    return {
       totalRevenue, totalRevenueWithoutGst, totalLostRevenue, totalExpensesAmount, netProfit,
       // Orders taken, not rows fetched — a voided order is not an order the cafe served.
       totalOrders: orders.filter(o => o.status !== 'cancelled').length,
       settledOrders: settledOrders.length,
       trendData, peakHoursData, topItems, topTables, catData, payData, payTotal, invData
    };
  }, [data, range.from, range.to]);

  if (loading || !metrics) return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-brand-primary"></div>
    </div>
  );

  const {
    totalRevenue, totalRevenueWithoutGst, totalLostRevenue, totalExpensesAmount, netProfit,
    totalOrders, settledOrders,
    trendData, peakHoursData, topItems, topTables, catData, payData, payTotal, invData
  } = metrics;

  const COLORS = ['#3B82F6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-brand-card p-4 rounded-xl shadow-2xl border border-brand-glass-border">
          <p className="font-bold text-brand-text mb-2">{label}</p>
          {payload.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-sm font-medium">
               <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }}></div>
               <span className="text-brand-text/80">{p.name}:</span>
               <span className="text-brand-text">
                 {p.name === 'Orders' || p.name === 'Qty Sold' ? p.value : `₹${Number(p.value).toFixed(0)}`}
               </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="pb-10 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-black text-brand-text mb-1">Analytics Dashboard</h2>
          <p className="text-sm font-medium text-brand-text/50">{range.label}</p>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {/* Summary of the Day — its own date, independent of the range above, because
          "does the till match?" is a question about one specific day. */}
      <div className="mb-8">
        <DaySummary day={summaryDay} onDayChange={setSummaryDay} />
      </div>

      {/* Top Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        <MetricCard title="Revenue (with GST)" value={`₹${totalRevenue.toFixed(2)}`} icon={<DollarSign size={24} />} colorClass="border-brand-success text-brand-success" />
        <MetricCard title="Revenue (without GST)" value={`₹${totalRevenueWithoutGst.toFixed(2)}`} icon={<DollarSign size={24} />} colorClass="border-brand-success text-brand-success" />
        <MetricCard title="Lost Revenue" value={`₹${totalLostRevenue.toFixed(0)}`} icon={<TrendingDown size={24} />} colorClass="border-red-400 text-red-400" />
        <MetricCard title="Orders" value={totalOrders} hint={`${settledOrders} settled`} icon={<ShoppingBag size={24} />} colorClass="border-brand-primary text-brand-primary" />
        <MetricCard title="Profit" value={`₹${netProfit.toFixed(0)}`} icon={netProfit >= 0 ? <TrendingUp size={24}/> : <TrendingDown size={24}/>} colorClass={netProfit >= 0 ? 'border-brand-success text-brand-success' : 'border-red-500 text-red-500'} />
        <MetricCard title="Expenses" value={`₹${totalExpensesAmount.toFixed(0)}`} icon={<Activity size={24} />} colorClass="border-red-500 text-red-500" />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Financial Trends */}
        <ChartCard title="Revenue vs Expenses & Profit">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.6}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
                </linearGradient>
                <linearGradient id="colorLost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f87171" stopOpacity={0.6}/>
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0.1}/>
                </linearGradient>
                <linearGradient id="colorExp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.6}/>
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0.1}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af" strokeOpacity={0.2} vertical={false} />
              <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} tickMargin={10} minTickGap={20} />
              <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={(val) => `₹${val}`} />
              <RechartsTooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
              <Area type="monotone" dataKey="lostRevenue" name="Lost Revenue" stroke="#f87171" strokeWidth={3} fillOpacity={1} fill="url(#colorLost)" />
              <Area type="monotone" dataKey="expenses" name="Expenses" stroke="#ef4444" strokeWidth={3} fillOpacity={1} fill="url(#colorExp)" />
              <Area type="monotone" dataKey="profit" name="Net Profit" stroke="#3b82f6" strokeWidth={3} fillOpacity={0} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Peak Hours */}
        <ChartCard title="Peak Operating Hours (Orders)" subtitle="Orders placed, by IST hour. Excludes cancelled orders.">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={peakHoursData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
               <defs>
                <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.6}/>
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.1}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af" strokeOpacity={0.2} vertical={false} />
              <XAxis dataKey="hour" stroke="#9ca3af" fontSize={12} minTickGap={30} />
              <YAxis stroke="#9ca3af" fontSize={12} />
              <RechartsTooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="orders" name="Orders" stroke="#8b5cf6" strokeWidth={3} fill="url(#colorOrders)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Top Items */}
        <ChartCard title="Top Selling Items" subtitle="Settled bills only. Revenue is net of discount and GST.">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topItems} layout="vertical" margin={{ top: 0, right: 20, left: 40, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af" strokeOpacity={0.2} horizontal={true} vertical={false} />
              <XAxis type="number" stroke="#9ca3af" fontSize={12} />
              <YAxis dataKey="name" type="category" stroke="#9ca3af" fontSize={12} width={100} />
              <RechartsTooltip content={<CustomTooltip />} />
              <Bar dataKey="qty" name="Qty Sold" radius={[0, 4, 4, 0]}>
                {topItems.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Top Tables */}
        <ChartCard title="Top Tables by Revenue" subtitle="Settled bills only. Net of discount and GST.">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topTables} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#9ca3af" strokeOpacity={0.2} vertical={false} />
              <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={(val) => `₹${val}`} />
              <RechartsTooltip content={<CustomTooltip />} />
              <Bar dataKey="revenue" name="Revenue" radius={[4, 4, 0, 0]}>
                {topTables.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[(index+2) % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Breakdown Row (3 cols on large screens) */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-6">
           <ChartCard title="Revenue by Category" subtitle="Sums to Revenue (without GST)." height="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={catData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                    {catData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip content={<CustomTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
           </ChartCard>

           <ChartCard title="Payment Methods" subtitle="Sums to Revenue (with GST). Unpaid = served, not yet settled." height="h-72">
              <div className="h-full flex flex-col justify-center gap-3">
                {payData.length === 0 ? (
                  <p className="text-sm text-brand-text/40 text-center">No bills in this period</p>
                ) : payData.map((entry, index) => (
                  <div key={entry.name} className={`flex items-center justify-between ${entry.isUnpaid ? 'pt-2 border-t border-dashed border-amber-500/40' : ''}`}>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.isUnpaid ? '#f59e0b' : COLORS[(index+1) % COLORS.length] }}></div>
                      <div>
                        <div className={`text-sm font-bold ${entry.isUnpaid ? 'text-amber-600 dark:text-amber-400' : 'text-brand-text/80'}`}>{entry.name}</div>
                        <div className="text-[10px] font-medium text-brand-text/40">
                          {entry.orders} {entry.orders === 1 ? 'bill' : 'bills'}
                        </div>
                      </div>
                    </div>
                    <span className={`text-lg font-black ${entry.isUnpaid ? 'text-amber-600 dark:text-amber-400' : 'text-brand-text'}`}>₹{entry.value.toFixed(2)}</span>
                  </div>
                ))}
                {payData.length > 0 && (
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-brand-glass-border">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-brand-text/50">Total = Revenue</span>
                    <span className="text-base font-black text-brand-text">₹{payTotal.toFixed(2)}</span>
                  </div>
                )}
              </div>
           </ChartCard>

           <ChartCard title="Inventory Status" height="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={invData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                    {invData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip content={<CustomTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
           </ChartCard>
        </div>

      </div>
    </div>
  );
}

// Subcomponents

function MetricCard({ title, value, icon, colorClass, hint }) {
  return (
    <div className={`bg-brand-card p-6 rounded-2xl border border-brand-glass-border flex items-center justify-between shadow-sm relative overflow-hidden group`}>
      <div className={`absolute -right-4 -top-4 w-24 h-24 rounded-full opacity-5 blur-2xl transition-all duration-500 group-hover:scale-150 ${colorClass.split(' ')[1]}`}></div>
      <div>
        <h3 className="text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-1">{title}</h3>
        <p className="text-2xl font-black text-brand-text tracking-tight">{value}</p>
        {hint && <p className="text-[10px] font-bold text-brand-text/40 mt-0.5">{hint}</p>}
      </div>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-brand-bg/50 border border-brand-glass-border/50 ${colorClass.split(' ')[1]}`}>
        {icon}
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, children, height = "h-80" }) {
  return (
    <div className="bg-brand-card rounded-2xl border border-brand-glass-border shadow-sm p-5 flex flex-col">
      <h3 className="text-sm font-bold text-brand-text/80">{title}</h3>
      {/* States the basis out loud, so a figure that looks low is understood rather than
          mistrusted — these charts count settled bills, not every order placed. */}
      <p className="text-[10px] font-medium text-brand-text/40 mb-4 mt-0.5">{subtitle || ' '}</p>
      <div className={`w-full ${height} min-h-[250px]`}>
        {children}
      </div>
    </div>
  );
}
