import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { orderRevenue, orderLostRevenue, isRevenueOrder } from '../lib/orderTotals';
import { getTaxRatePercent } from '../lib/appSettings';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { DollarSign, CreditCard, ShoppingCart, TrendingUp, TrendingDown, Wallet, Sun, Moon, Sunrise, Sunset } from 'lucide-react';
import { format, subDays, startOfDay, startOfWeek, startOfMonth, isAfter, isBefore } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import Skeleton from '../components/Skeleton';
import DateRangePicker from '../components/DateRangePicker';
import { presetRange, businessDayStartUtc, todayBusinessDay } from '../lib/businessDay';
import { useGreeting } from '../lib/useGreeting';

export default function Dashboard() {
  const [orders, setOrders] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  // Shared with the KDS front page via src/lib/greeting.js — a second copy of the hour
  // logic is how the two headings drifted apart in the first place.
  const { greeting, period: timeIcon, now: currentTime } = useGreeting();
  // Defaults to today, so the headline cards read exactly as they always have until the
  // owner picks something else.
  const [range, setRange] = useState(() => presetRange('today'));

  useEffect(() => {
    fetchData();

    const ordersSub = supabase
      .channel('dashboard_orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchData)
      .subscribe();
      
    const orderItemsSub = supabase
      .channel('dashboard_order_items')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, fetchData)
      .subscribe();

    const expensesSub = supabase
      .channel('dashboard_expenses')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, fetchData)
      .subscribe();

    const inventorySub = supabase
      .channel('dashboard_inventory')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(ordersSub);
      supabase.removeChannel(orderItemsSub);
      supabase.removeChannel(expensesSub);
      supabase.removeChannel(inventorySub);
    };
  }, []);

  // Refetch when the picked range changes. Kept separate from the subscription effect
  // above so changing the date doesn't tear down and re-open four realtime channels.
  useEffect(() => {
    fetchData();
  }, [range.fromUtc, range.toUtc]);

  const fetchData = async () => {
    // The window must cover BOTH the range the user picked and the fixed This Week /
    // This Month blocks below, otherwise those blocks would silently read from data
    // that was never fetched and show too-low numbers.
    const monthStart = businessDayStartUtc(`${todayBusinessDay().slice(0, 7)}-01`).toISOString();
    const windowStart = range.fromUtc < monthStart ? range.fromUtc : monthStart;

    // Fetch all orders with their items
    const { data: ordersData } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .gte('created_at', windowStart);

    // Fetch all expenses
    const { data: expensesData } = await supabase
      .from('expenses')
      .select('*')
      .gte('date', windowStart);

    // Fetch inventory
    const { data: inventoryData } = await supabase
      .from('inventory')
      .select('category');

    if (ordersData) setOrders(ordersData);
    if (expensesData) setExpenses(expensesData);
    if (inventoryData) setInventory(inventoryData);
    setLoading(false);
  };

  // --- Helper to calculate metrics for a given date range ---
  // `endDate` is exclusive and optional: the fixed Week/Month blocks pass only a start
  // (everything since), while the range picker passes both bounds.
  const calculateMetrics = (startDate, endDate = null) => {
    const inWindow = (d) => {
      const t = new Date(d);
      return t >= startDate && (endDate === null || t < endDate);
    };
    const periodOrders = orders.filter(o => inWindow(o.created_at));
    const periodExpenses = expenses.filter(e => inWindow(e.date));

    // Revenue only counts paid/done orders
    const completedOrders = periodOrders.filter(o => o.status === 'done' || o.status === 'paid');
    
    // "Revenue" means the same thing on every page: gross — what was actually collected,
    // GST and discount included, so it reconciles against the cash drawer and the bills.
    // Profit is built from net, because GST collected is the government's money, not income.
    const rate = getTaxRatePercent() ?? 0;
    const revenue = completedOrders.reduce((sum, order) => sum + orderRevenue(order, rate).gross, 0);
    const netRevenue = completedOrders.reduce((sum, order) => sum + orderRevenue(order, rate).net, 0);

    const lostRevenue = periodOrders.reduce((sum, order) => sum + orderLostRevenue(order), 0);

    const totalExpenses = periodExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    const profit = netRevenue - totalExpenses;
    const ordersCount = periodOrders.length;

    return { revenue, netRevenue, lostRevenue, expenses: totalExpenses, profit, ordersCount };
  };

  const thisWeek = startOfWeek(new Date(), { weekStartsOn: 1 }); // Monday start
  const thisMonth = startOfMonth(new Date());

  // The headline cards follow whatever range is picked (defaults to today, so the page
  // looks unchanged until the owner asks for something else). Week/Month stay fixed.
  const todayMetrics = calculateMetrics(new Date(range.fromUtc), new Date(range.toUtc));
  const weekMetrics = calculateMetrics(thisWeek);
  const monthMetrics = calculateMetrics(thisMonth);

  // --- Chart Data: Last 7 Days (Revenue vs Expenses) ---
  const last7DaysData = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = startOfDay(subDays(new Date(), i));
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const dayOrders = orders.filter(o => {
      const d = new Date(o.created_at);
      return d >= dayStart && d <= dayEnd && isRevenueOrder(o);
    });
    
    const dayExpenses = expenses.filter(e => {
      const d = new Date(e.date);
      return d >= dayStart && d <= dayEnd;
    });

    const dRev = dayOrders.reduce((sum, order) => sum + orderRevenue(order, getTaxRatePercent() ?? 0).gross, 0);

    const dExp = dayExpenses.reduce((sum, exp) => sum + exp.amount, 0);

    last7DaysData.push({
      name: format(dayStart, 'd MMM'),
      Revenue: dRev,
      Expenses: dExp
    });
  }

  // --- Chart Data: Inventory Categories ---
  const categoryData = inventory.reduce((acc, item) => {
    const cat = item.category || 'Other';
    const existing = acc.find(i => i.name === cat);
    if (existing) {
      existing.value += 1;
    } else {
      acc.push({ name: cat, value: 1 });
    }
    return acc;
  }, []).sort((a, b) => b.value - a.value);

  const COLORS = ['#f97316', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#6366f1'];

  // Custom tooltips
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-brand-bg border border-brand-glass-border p-3 rounded-xl shadow-lg">
          <p className="font-bold text-brand-text mb-2">{label}</p>
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center gap-2 text-sm font-medium">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></div>
              <span style={{ color: entry.color }}>{entry.name}: ₹{entry.value.toLocaleString('en-IN')}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-8 pb-8">
        <div className="flex justify-between items-end mb-4">
          <div>
            <Skeleton className="w-48 h-10 mb-2" />
            <Skeleton className="w-32 h-6" />
          </div>
          <div className="flex flex-col items-end">
            <Skeleton className="w-16 h-6 mb-1" />
            <Skeleton className="w-24 h-4" />
          </div>
        </div>
        <div>
          <Skeleton className="w-16 h-3 mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-32" />)}
          </div>
        </div>
        <div>
          <Skeleton className="w-24 h-3 mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-32" />)}
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-8">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-4 gap-4">
        <div>
          <h1 className="text-3xl font-black text-brand-text mb-2 tracking-tight">Dashboard</h1>
          <AnimatePresence mode="wait">
            <motion.div 
              key={timeIcon}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="flex items-center gap-2 text-brand-text/60 font-medium bg-brand-secondary/10 px-3 py-1.5 rounded-full w-fit border border-brand-glass-border shadow-sm"
            >
              <motion.div
                initial={{ rotate: -30, scale: 0.5 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ duration: 0.8, type: "spring", bounce: 0.5 }}
              >
                {timeIcon === 'morning' && <Sunrise className="text-yellow-500" size={18} />}
                {timeIcon === 'afternoon' && <Sun className="text-orange-500" size={18} />}
                {timeIcon === 'evening' && <Sunset className="text-blue-400" size={18} />}
                {timeIcon === 'night' && <Moon className="text-indigo-400" size={18} />}
              </motion.div>
              <span>{greeting}, Admin!</span>
            </motion.div>
          </AnimatePresence>
        </div>
        
        <div className="text-right">
          <div className="text-lg font-black text-brand-text tracking-widest">{format(currentTime, 'hh:mm a')}</div>
          <div className="text-xs font-bold text-brand-text/40 uppercase tracking-widest">{format(currentTime, 'EEEE, MMM do')}</div>
        </div>
      </div>

      {/* TODAY SECTION */}
      <div>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <h3 className="text-xs font-bold text-brand-text/40 tracking-widest uppercase">{range.label}</h3>
          <DateRangePicker value={range} onChange={setRange} clearTo="today" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          
          {/* Revenue */}
          <div className="bg-brand-card rounded-xl border border-brand-glass-border overflow-hidden relative p-5 hover:-translate-y-1 transition-transform">
            <div className="absolute top-0 left-0 right-0 h-1 bg-green-500"></div>
            <div className="flex justify-between items-start mb-2">
              <div className="text-[10px] font-bold tracking-widest text-brand-text/50 uppercase">Revenue</div>
              <DollarSign size={16} className="text-brand-text/20" />
            </div>
            <div className="text-3xl font-black text-green-500 mb-1 flex items-center">
              <span className="text-xl mr-1">₹</span>
              {todayMetrics.revenue.toLocaleString('en-IN')}
            </div>
            <div className="text-[10px] font-medium text-brand-text/40">from orders</div>
          </div>

          {/* Loss Revenue */}
          <div className="bg-brand-card rounded-xl border border-brand-glass-border overflow-hidden relative p-5 hover:-translate-y-1 transition-transform">
            <div className="absolute top-0 left-0 right-0 h-1 bg-red-400"></div>
            <div className="flex justify-between items-start mb-2">
              <div className="text-[10px] font-bold tracking-widest text-brand-text/50 uppercase">Loss Rev</div>
              <TrendingDown size={16} className="text-brand-text/20" />
            </div>
            <div className="text-3xl font-black text-red-400 mb-1 flex items-center">
              <span className="text-xl mr-1">₹</span>
              {todayMetrics.lostRevenue.toLocaleString('en-IN')}
            </div>
            <div className="text-[10px] font-medium text-brand-text/40">cancelled orders</div>
          </div>

          {/* Expenses */}
          <div className="bg-brand-card rounded-xl border border-brand-glass-border overflow-hidden relative p-5 hover:-translate-y-1 transition-transform">
            <div className="absolute top-0 left-0 right-0 h-1 bg-red-500"></div>
            <div className="flex justify-between items-start mb-2">
              <div className="text-[10px] font-bold tracking-widest text-brand-text/50 uppercase">Expenses</div>
              <Wallet size={16} className="text-brand-text/20" />
            </div>
            <div className="text-3xl font-black text-red-500 mb-1 flex items-center">
              <span className="text-xl mr-1">₹</span>
              {todayMetrics.expenses.toLocaleString('en-IN')}
            </div>
            <div className="text-[10px] font-medium text-brand-text/40">total spent</div>
          </div>

          {/* Profit */}
          <div className="bg-brand-card rounded-xl border border-brand-glass-border overflow-hidden relative p-5 hover:-translate-y-1 transition-transform">
            <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500"></div>
            <div className="flex justify-between items-start mb-2">
              <div className="text-[10px] font-bold tracking-widest text-brand-text/50 uppercase">Profit</div>
              <TrendingUp size={16} className="text-brand-text/20" />
            </div>
            <div className={`text-3xl font-black mb-1 flex items-center ${todayMetrics.profit >= 0 ? 'text-blue-500' : 'text-red-500'}`}>
              <span className="text-xl mr-1">₹</span>
              {todayMetrics.profit.toLocaleString('en-IN')}
            </div>
            <div className="text-[10px] font-medium text-brand-text/40">net earnings</div>
          </div>

          {/* Orders */}
          <div className="bg-brand-card rounded-xl border border-brand-glass-border overflow-hidden relative p-5 hover:-translate-y-1 transition-transform">
            <div className="absolute top-0 left-0 right-0 h-1 bg-brand-primary"></div>
            <div className="flex justify-between items-start mb-2">
              <div className="text-[10px] font-bold tracking-widest text-brand-text/50 uppercase">Orders</div>
              <ShoppingCart size={16} className="text-brand-text/20" />
            </div>
            <div className="text-3xl font-black text-brand-text mb-1 flex items-center">
              {todayMetrics.ordersCount}
            </div>
            <div className="text-[10px] font-medium text-brand-text/40">total orders</div>
          </div>

        </div>
      </div>

      {/* WEEK & MONTH OVERVIEW */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* This Week */}
        <div className="bg-brand-card rounded-xl border border-brand-glass-border p-5">
          <h3 className="text-sm font-bold text-brand-text mb-5">This Week</h3>
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center bg-brand-bg border border-brand-glass-border rounded-xl p-3">
              <div className="text-[10px] font-bold text-brand-text/40 uppercase tracking-widest mb-1">Revenue</div>
              <div className="font-black text-green-500">₹{weekMetrics.revenue.toLocaleString('en-IN')}</div>
            </div>
            <div className="text-center bg-brand-bg border border-brand-glass-border rounded-xl p-3">
              <div className="text-[10px] font-bold text-brand-text/40 uppercase tracking-widest mb-1">Loss</div>
              <div className="font-black text-red-400">₹{weekMetrics.lostRevenue.toLocaleString('en-IN')}</div>
            </div>
            <div className="text-center bg-brand-bg border border-brand-glass-border rounded-xl p-3">
              <div className="text-[10px] font-bold text-brand-text/40 uppercase tracking-widest mb-1">Expenses</div>
              <div className="font-black text-red-500">₹{weekMetrics.expenses.toLocaleString('en-IN')}</div>
            </div>
            <div className="text-center bg-brand-bg border border-brand-glass-border rounded-xl p-3">
              <div className="text-[10px] font-bold text-brand-text/40 uppercase tracking-widest mb-1">Profit</div>
              <div className={`font-black ${weekMetrics.profit >= 0 ? 'text-blue-500' : 'text-red-500'}`}>
                ₹{weekMetrics.profit.toLocaleString('en-IN')}
              </div>
            </div>
          </div>
        </div>

        {/* This Month */}
        <div className="bg-brand-card rounded-xl border border-brand-glass-border p-5">
          <h3 className="text-sm font-bold text-brand-text mb-5">This Month</h3>
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center bg-brand-bg border border-brand-glass-border rounded-xl p-3">
              <div className="text-[10px] font-bold text-brand-text/40 uppercase tracking-widest mb-1">Revenue</div>
              <div className="font-black text-green-500">₹{monthMetrics.revenue.toLocaleString('en-IN')}</div>
            </div>
            <div className="text-center bg-brand-bg border border-brand-glass-border rounded-xl p-3">
              <div className="text-[10px] font-bold text-brand-text/40 uppercase tracking-widest mb-1">Loss</div>
              <div className="font-black text-red-400">₹{monthMetrics.lostRevenue.toLocaleString('en-IN')}</div>
            </div>
            <div className="text-center bg-brand-bg border border-brand-glass-border rounded-xl p-3">
              <div className="text-[10px] font-bold text-brand-text/40 uppercase tracking-widest mb-1">Expenses</div>
              <div className="font-black text-red-500">₹{monthMetrics.expenses.toLocaleString('en-IN')}</div>
            </div>
            <div className="text-center bg-brand-bg border border-brand-glass-border rounded-xl p-3">
              <div className="text-[10px] font-bold text-brand-text/40 uppercase tracking-widest mb-1">Profit</div>
              <div className={`font-black ${monthMetrics.profit >= 0 ? 'text-blue-500' : 'text-red-500'}`}>
                ₹{monthMetrics.profit.toLocaleString('en-IN')}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* CHARTS SECTION */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Bar Chart (Revenue vs Expenses) */}
        <div className="xl:col-span-2 bg-brand-card rounded-xl border border-brand-glass-border p-5 flex flex-col h-[400px]">
          <h3 className="text-sm font-bold text-brand-text mb-6">Revenue vs Expenses (7 days)</h3>
          <div className="flex-1 w-full relative">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={last7DaysData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={4}>
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: 'var(--text-color)', opacity: 0.5, fontSize: 11, fontWeight: 600 }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: 'var(--text-color)', opacity: 0.5, fontSize: 11, fontWeight: 600 }}
                  tickFormatter={(val) => `₹${val}`}
                />
                <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'var(--glass-border)', opacity: 0.3 }} />
                <Legend 
                  iconType="square" 
                  iconSize={10} 
                  wrapperStyle={{ fontSize: 12, fontWeight: 600, color: 'var(--text-color)', opacity: 0.8, paddingTop: 10 }}
                />
                <Bar dataKey="Revenue" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pie Chart (Inventory Categories) */}
        <div className="bg-brand-card rounded-xl border border-brand-glass-border p-5 flex flex-col h-[400px]">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-sm font-bold text-brand-text">Inventory Breakdown</h3>
          </div>
          
          {categoryData.length > 0 ? (
            <div className="flex-1 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    innerRadius={0}
                    outerRadius={110}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip 
                    formatter={(value) => `${value} items`}
                    contentStyle={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--glass-border)', borderRadius: '12px', color: 'var(--text-color)', fontWeight: 'bold' }}
                    itemStyle={{ color: 'var(--text-color)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-brand-text/30 font-medium text-sm">
              No inventory recorded
            </div>
          )}

          {/* Custom Legend for top 4 categories */}
          <div className="mt-4 flex flex-col gap-2">
            {categoryData.slice(0, 4).map((entry, idx) => (
              <div key={entry.name} className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
                  <span className="font-medium text-brand-text/70">{entry.name}</span>
                </div>
                <span className="font-bold text-brand-text">{entry.value} items</span>
              </div>
            ))}
          </div>

        </div>

      </div>

    </div>
  );
}
