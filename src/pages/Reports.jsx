import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { orderRevenue, isRevenueOrder } from '../lib/orderTotals';
import DateRangePicker, { DEFAULT_RANGE } from '../components/DateRangePicker';
import { getTaxRatePercent } from '../lib/appSettings';
import { Download, TrendingUp, TrendingDown, BarChart2, Package, Users, CreditCard, Store, Trophy } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';

export default function Reports() {
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [revenue, setRevenue] = useState(0);
  // Net of GST — profit must be built from this, not from gross, or it is overstated by
  // the tax collected on the government's behalf.
  const [netRevenue, setNetRevenue] = useState(0);
  const [expenses, setExpenses] = useState(0);

  useEffect(() => {
    fetchStats();
  }, [range.fromUtc, range.toUtc]);

  const fetchStats = async () => {
    // Revenue — orders have no stored total; it's derived from order_items, same as the Revenue page.
    const { data: orderData } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .gte('created_at', range.fromUtc)
      .lt('created_at', range.toUtc);

    // Gross, via the shared helper, so this headline matches Dashboard/Revenue/Analytics.
    const rate = getTaxRatePercent() ?? 0;
    const revenueOrders = (orderData || []).filter(isRevenueOrder);
    setRevenue(revenueOrders.reduce((sum, order) => sum + orderRevenue(order, rate).gross, 0));
    setNetRevenue(revenueOrders.reduce((sum, order) => sum + orderRevenue(order, rate).net, 0));

    // Expenses
    const { data: expData } = await supabase
      .from('expenses')
      .select('amount')
      .gte('date', range.fromUtc).lt('date', range.toUtc);
    
    const totalExp = (expData || []).reduce((sum, exp) => sum + (exp.amount || 0), 0);
    setExpenses(totalExp);
  };

  const downloadCSV = (filename, headers, rows) => {
    if (rows.length === 0) {
      toast.error('No data found for this period');
      return;
    }
    // Numbers are left unquoted so Excel/Sheets reads them as actual numbers (sortable, summable)
    // instead of text; only text fields get quoted (and escaped) since they may contain commas.
    const formatCell = (cell) => (
      typeof cell === 'number' ? String(cell) : `"${String(cell ?? '').replace(/"/g, '""')}"`
    );
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(formatCell).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Each builder fetches its own data and returns {filename, headers, rows} — used both for
  // the individual report buttons and for "Full Business Report", which just runs all of them.
  const reportBuilders = {
    'Revenue Report': async (r) => {
      const { data } = await supabase.from('orders').select('*, order_items(*)').gte('created_at', r.fromUtc).lt('created_at', r.toUtc).order('created_at', { ascending: false });
      const rows = (data || [])
        .filter(isRevenueOrder)
        .map(o => {
          // Gross — the amount the customer actually paid, GST and discount included.
          const total = orderRevenue(o, getTaxRatePercent() ?? 0).gross;
          return [format(new Date(o.created_at), 'yyyy-MM-dd HH:mm'), o.id, o.customer_name || 'Walk-in', o.table_no || '-', o.status, total, o.payment_method || '-'];
        });
      return { filename: 'Revenue_Report', headers: ['Date', 'Order ID', 'Customer', 'Table', 'Status', 'Amount', 'Payment Method'], rows };
    },
    'Expense Report': async (r) => {
      const { data } = await supabase.from('expenses').select('*').gte('date', r.fromUtc).lt('date', r.toUtc).order('date', { ascending: false });
      const rows = (data || []).map(e => [format(new Date(e.date), 'yyyy-MM-dd'), e.description, e.category, e.amount, e.payment_method || '-', e.vendor || '-']);
      return { filename: 'Expense_Report', headers: ['Date', 'Title', 'Category', 'Amount', 'Payment Method', 'Vendor'], rows };
    },
    'Profit Report': async () => ({
      filename: 'Profit_Report',
      headers: ['Metric', 'Amount'],
      rows: [
        ['Total Revenue', revenue],
        ['Total Expenses', expenses],
        ['Net Revenue (excl. GST)', netRevenue],
        ['Net Profit', netRevenue - expenses]
      ]
    }),
    'Inventory Report': async () => {
      const { data } = await supabase.from('inventory').select('*').order('name');
      const rows = (data || []).map(i => [i.name, i.category, i.quantity, i.unit, i.min_stock, i.cost_price, i.selling_price, i.supplier || '-']);
      return { filename: 'Inventory_Report', headers: ['Item', 'Category', 'Stock Qty', 'Unit', 'Min Stock', 'Cost Price', 'Selling Price', 'Supplier'], rows };
    },
    'Employee Report': async () => {
      const { data } = await supabase.from('employees').select('*').order('full_name');
      const rows = (data || []).map(e => [e.full_name, e.position, e.phone || '-', e.joining_date ? format(new Date(e.joining_date), 'yyyy-MM-dd') : '-', e.monthly_salary, e.status]);
      return { filename: 'Employee_Report', headers: ['Name', 'Position', 'Phone', 'Joining Date', 'Monthly Salary', 'Status'], rows };
    },
    'Salary Report': async (r) => {
      const { data } = await supabase.from('salaries').select('*, employees(full_name, position)').gte('payment_date', r.fromUtc).lt('payment_date', r.toUtc).order('payment_date', { ascending: false });
      const rows = (data || []).map(s => [s.payment_date ? format(new Date(s.payment_date), 'yyyy-MM-dd') : '-', s.employees?.full_name || 'Unknown', s.employees?.position || '-', s.month, s.year, s.amount, s.status, s.remarks || '-']);
      return { filename: 'Salary_Report', headers: ['Date', 'Employee', 'Position', 'Month', 'Year', 'Amount', 'Status', 'Remarks'], rows };
    },
    'Vendor Report': async () => {
      const { data } = await supabase.from('vendors').select('*').order('name');
      const rows = (data || []).map(v => [v.name, v.contact_person || '-', v.phone || '-', v.email || '-', v.products || '-', v.outstanding_amount || 0]);
      return { filename: 'Vendor_Report', headers: ['Name', 'Contact Person', 'Phone', 'Email', 'Products', 'Outstanding Amount'], rows };
    }
  };

  const handleDownload = async (type) => {
    const loadingId = toast.loading(`Preparing ${type}...`);
    try {
      // Builders take the whole range object so every report is bounded on both ends.

      if (type === 'Full Business Report') {
        const formatCell = (cell) => (
          typeof cell === 'number' ? String(cell) : `"${String(cell ?? '').replace(/"/g, '""')}"`
        );
        const sections = [];
        for (const [name, builder] of Object.entries(reportBuilders)) {
          const { headers, rows } = await builder(range);
          if (rows.length === 0) continue;
          sections.push([
            `"${name}"`,
            headers.join(','),
            ...rows.map(row => row.map(formatCell).join(','))
          ].join('\n'));
        }
        if (sections.length === 0) {
          toast.error('No data found for this period', { id: loadingId });
          return;
        }
        // One file, sections stacked with a title row and a blank line between them —
        // instead of firing off seven separate downloads (which opened a pile of windows).
        const csvContent = sections.join('\n\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Full_Business_Report_${format(new Date(), 'yyyy-MM-dd')}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);

        toast.success('Full business report downloaded!', { id: loadingId });
        return;
      }

      const builder = reportBuilders[type];
      if (!builder) {
        toast.error(`Unknown report type: ${type}`, { id: loadingId });
        return;
      }
      const { filename, headers, rows } = await builder(range);
      downloadCSV(filename, headers, rows);

      toast.success(`${type} downloaded successfully!`, { id: loadingId });
    } catch (err) {
      console.error(err);
      toast.error(`Failed to download ${type}`, { id: loadingId });
    }
  };

  const profit = netRevenue - expenses;

  return (
    <div className="flex flex-col gap-6 animate-fade-in max-w-7xl mx-auto w-full">
      <div className="flex justify-between items-start md:items-center flex-col md:flex-row gap-4 mb-2">
        <div>
          <h1 className="text-3xl font-black text-brand-text mb-1 tracking-tight">Reports</h1>
          <p className="text-brand-text/50 font-medium">Download business reports</p>
        </div>
      </div>

      <div className="glass p-6 rounded-2xl border border-brand-glass-border">
        <label className="block text-sm font-bold text-brand-text/70 mb-2">Date Range — {range.label}</label>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        
        {/* Revenue Report */}
        <ReportCard 
          icon={TrendingUp} 
          title="Revenue Report" 
          desc="All orders in the selected period" 
          value={`₹${revenue.toLocaleString()}`}
          valueColor="text-green-500"
          onDownload={() => handleDownload('Revenue Report')} 
        />

        {/* Expense Report */}
        <ReportCard 
          icon={TrendingDown} 
          title="Expense Report" 
          desc="All expenses in the selected period" 
          value={`₹${expenses.toLocaleString()}`}
          valueColor="text-red-500"
          onDownload={() => handleDownload('Expense Report')} 
        />

        {/* Profit Report */}
        <ReportCard 
          icon={BarChart2} 
          title="Profit Report" 
          desc="Revenue minus expenses" 
          value={`₹${profit.toLocaleString()}`}
          valueColor={profit >= 0 ? "text-green-500" : "text-red-500"}
          onDownload={() => handleDownload('Profit Report')} 
        />

        {/* Inventory Report */}
        <ReportCard 
          icon={Package} 
          title="Inventory Report" 
          desc="Current stock and valuation" 
          onDownload={() => handleDownload('Inventory Report')} 
        />

        {/* Employee Report */}
        <ReportCard 
          icon={Users} 
          title="Employee Report" 
          desc="Employee directory" 
          onDownload={() => handleDownload('Employee Report')} 
        />

        {/* Salary Report */}
        <ReportCard 
          icon={CreditCard} 
          title="Salary Report" 
          desc="Salary payment history" 
          onDownload={() => handleDownload('Salary Report')} 
        />

        {/* Vendor Report */}
        <ReportCard 
          icon={Store} 
          title="Vendor Report" 
          desc="Vendor list and outstanding amounts" 
          onDownload={() => handleDownload('Vendor Report')} 
        />

        {/* Complete Business Report */}
        <motion.div 
          whileHover={{ y: -4 }}
          className="bg-brand-card rounded-2xl p-6 border-2 border-brand-primary shadow-lg shadow-brand-primary/10 flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Trophy size={20} className="text-brand-primary" />
              <h3 className="font-bold text-brand-text">Complete Business Report</h3>
            </div>
            <p className="text-brand-text/50 text-sm font-medium mb-6">All data in one Excel file</p>
          </div>
          <button 
            onClick={() => handleDownload('Full Business Report')}
            className="bg-brand-primary text-white font-bold py-2.5 px-4 rounded-xl flex items-center gap-2 hover:bg-brand-primary/90 transition-colors w-max"
          >
            <Download size={16} /> Download Full Report
          </button>
        </motion.div>

      </div>
    </div>
  );
}

function ReportCard({ icon: Icon, title, desc, value, valueColor, onDownload }) {
  return (
    <motion.div 
      whileHover={{ y: -4 }}
      className="bg-brand-card rounded-2xl p-6 border border-brand-glass-border shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow"
    >
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Icon size={18} className="text-brand-primary" />
          <h3 className="font-bold text-brand-text">{title}</h3>
        </div>
        <p className="text-brand-text/50 text-sm font-medium mb-4">{desc}</p>
        {value !== undefined && (
          <div className={`text-2xl font-black mb-6 ${valueColor}`}>{value}</div>
        )}
      </div>
      <button 
        onClick={onDownload}
        className="bg-brand-primary text-white font-bold py-2 px-4 rounded-xl flex items-center gap-2 hover:bg-brand-primary/90 transition-colors w-max text-sm"
      >
        <Download size={14} /> Download Excel
      </button>
    </motion.div>
  );
}
