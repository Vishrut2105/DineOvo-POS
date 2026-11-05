import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Search, Download, X, DollarSign, Calendar, Edit2, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import DateRangePicker, { DEFAULT_RANGE } from '../components/DateRangePicker';

const CATEGORIES = [
  'Inventory', 'Rent', 'Utilities', 'Salary', 'Marketing', 
  'Maintenance', 'Transport', 'Internet', 'Software', 'Miscellaneous'
];

const PAYMENT_METHODS = ['Online/UPI', 'Cash', 'Card'];

export default function Expenses() {
  const [expenses, setExpenses] = useState([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');
  const [selectedPayment, setSelectedPayment] = useState('All Payments');
  // Shared with every other money page, so 'This Month' means the same thing here as on
  // Revenue and Analytics. Replaces a dropdown that stored a value nothing ever read.
  const [range, setRange] = useState(DEFAULT_RANGE);

  // Modal Form State
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [vendor, setVendor] = useState('');
  const [notes, setNotes] = useState('');

  // The realtime handler below is registered once and would otherwise close over the
  // range that was current at mount — a ref keeps it reading the live selection.
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const fetchExpenses = async () => {
    // Bounded by the picked range — this used to pull the entire table on every visit.
    const { fromUtc, toUtc } = rangeRef.current;
    const { data } = await supabase
      .from('expenses').select('*')
      .gte('date', fromUtc).lt('date', toUtc)
      .order('date', { ascending: false });
    if (data) setExpenses(data);
  };

  useEffect(() => {
    fetchExpenses();
  }, [range.fromUtc, range.toUtc]);

  useEffect(() => {
    const subscription = supabase
      .channel('expenses_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, fetchExpenses)
      .subscribe();

    return () => supabase.removeChannel(subscription);
  }, []);

  const resetForm = () => {
    setTitle(''); setAmount(''); setCategory(CATEGORIES[0]); 
    setDate(new Date().toISOString().split('T')[0]);
    setPaymentMethod(PAYMENT_METHODS[0]); setVendor(''); setNotes('');
    setEditingId(null);
    setIsAddOpen(false);
  };

  const openEditModal = (exp) => {
    setTitle(exp.description || '');
    setAmount(exp.amount || '');
    setCategory(exp.category || CATEGORIES[0]);
    setDate(exp.date ? new Date(exp.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
    setPaymentMethod(exp.payment_method || PAYMENT_METHODS[0]);
    setVendor(exp.vendor || '');
    setNotes(exp.notes || '');
    setEditingId(exp.id);
    setIsAddOpen(true);
  };

  const handleAdd = async () => {
    if (!title || !amount) {
      toast.error('Title and Amount are required');
      return;
    }
    
    const insertData = { 
      description: title, 
      amount: parseFloat(amount), 
      category: category,
      date: new Date(date).toISOString(),
    };
    
    try {
      const fullData = {
        ...insertData,
        payment_method: paymentMethod,
        vendor: vendor,
        notes: notes
      };

      if (editingId) {
        const { error } = await supabase.from('expenses').update(fullData).eq('id', editingId);
        if (error && error.code === '42703') {
          await supabase.from('expenses').update(insertData).eq('id', editingId);
          toast.success('Expense updated (base fields only)');
        } else if (error) throw error;
        else toast.success('Expense updated successfully');
      } else {
        const { error } = await supabase.from('expenses').insert(fullData);
        if (error && error.code === '42703') {
          await supabase.from('expenses').insert(insertData);
          toast.success('Expense added (base fields only)');
        } else if (error) throw error;
        else {
          toast.success('Expense added successfully');
          
          // Sync: If category is Inventory, also add to inventory table
          if (category === 'Inventory') {
            await supabase.from('inventory').insert({
              name: title,
              category: 'Other',
              quantity: 1,
              unit: 'pcs',
              min_stock: 0,
              cost_price: parseFloat(amount),
              selling_price: 0,
              supplier: vendor || '',
              date_added: date,
              notes: `Auto-added from Expenses: ${notes || ''}`
            });
          }
        }
      }
    } catch (err) {
      console.error(err);
      toast.error('An error occurred');
    }

    resetForm();
    fetchExpenses();
  };

  const confirmDelete = async () => {
    if (!deletingId) return;
    try {
      await supabase.from('expenses').delete().eq('id', deletingId);
      toast.success('Expense deleted successfully');
      fetchExpenses();
    } catch (err) {
      console.error(err);
      toast.error('Error deleting expense');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredExpenses = expenses.filter(exp => {
    const matchesSearch = exp.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (exp.vendor || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All Categories' || exp.category === selectedCategory;
    const matchesPayment = selectedPayment === 'All Payments' || exp.payment_method === selectedPayment;
    return matchesSearch && matchesCategory && matchesPayment;
  });

  const exportToCSV = () => {
    if (filteredExpenses.length === 0) {
      alert('No data to export!');
      return;
    }

    // CSV Headers
    const headers = ['Date', 'Title', 'Category', 'Amount', 'Payment Method', 'Vendor', 'Notes'];
    
    // CSV Rows
    const rows = filteredExpenses.map(exp => [
      format(new Date(exp.date), 'yyyy-MM-dd'),
      `"${(exp.description || '').replace(/"/g, '""')}"`,
      `"${(exp.category || 'Miscellaneous').replace(/"/g, '""')}"`,
      exp.amount.toFixed(2),
      `"${(exp.payment_method || '').replace(/"/g, '""')}"`,
      `"${(exp.vendor || '').replace(/"/g, '""')}"`,
      `"${(exp.notes || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    
    // Create Blob and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `expenses_export_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const categoryData = filteredExpenses.reduce((acc, exp) => {
    const cat = exp.category || 'Miscellaneous';
    const existing = acc.find(item => item.name === cat);
    if (existing) {
      existing.value += exp.amount;
    } else {
      acc.push({ name: cat, value: exp.amount });
    }
    return acc;
  }, []).sort((a, b) => b.value - a.value);

  const COLORS = [
    '#f97316', '#3b82f6', '#10b981', '#ef4444', 
    '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', 
    '#6366f1', '#eab308', '#06b6d4', '#d946ef'
  ];

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      
      {/* Header Section */}
      <div className="flex justify-between items-start md:items-center flex-col md:flex-row gap-4 mb-2">
        <div>
          <h1 className="text-3xl font-black text-brand-text mb-1 tracking-tight">Expenses</h1>
          <p className="text-brand-text/50 font-medium">Track and manage all cafe expenses</p>
        </div>
        <button 
          className="btn bg-brand-primary text-white hover:bg-brand-primary/90 shadow-lg shadow-brand-primary/20 transition-all font-bold"
          onClick={() => setIsAddOpen(true)}
        >
          <Plus size={18} /> Add Expense
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Main Content Area (Table + Filters) */}
        <div className="glass p-6 rounded-2xl flex flex-col gap-6 xl:col-span-3 border border-brand-glass-border">
          
          {/* Filters Bar */}
          <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
            <div className="flex flex-wrap gap-4 items-center w-full md:w-auto">
              
              {/* Search */}
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search size={16} className="text-brand-text/40" />
                </div>
                <input
                  type="text"
                  placeholder="Search expenses..."
                  className="bg-brand-bg border border-brand-glass-border text-brand-text rounded-xl pl-10 pr-4 py-2 w-full md:w-64 focus:outline-none focus:border-brand-primary/50 transition-colors"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              {/* Category Filter */}
              <div className="relative">
                <select 
                  className="bg-brand-bg border border-brand-glass-border text-brand-text rounded-xl pl-4 pr-10 py-2 appearance-none focus:outline-none focus:border-brand-primary/50 transition-colors"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  <option>All Categories</option>
                  {CATEGORIES.map(cat => <option key={cat}>{cat}</option>)}
                </select>
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <ChevronDown size={16} className="text-brand-text/40" />
                </div>
              </div>

              {/* Payment Mode Filter */}
              <div className="relative">
                <select
                  aria-label="Filter by payment mode"
                  className={`bg-brand-bg border text-brand-text rounded-xl pl-4 pr-10 py-2 appearance-none focus:outline-none transition-colors ${
                    selectedPayment === 'All Payments'
                      ? 'border-brand-glass-border focus:border-brand-primary/50'
                      : 'border-brand-primary/50 text-brand-primary font-bold'
                  }`}
                  value={selectedPayment}
                  onChange={(e) => setSelectedPayment(e.target.value)}
                >
                  <option>All Payments</option>
                  {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <ChevronDown size={16} className="text-brand-text/40" />
                </div>
              </div>

              {/* Date range — the same control every other money page uses */}
              <DateRangePicker value={range} onChange={setRange} />
            </div>

            <button 
              onClick={exportToCSV}
              className="btn btn-secondary border border-brand-glass-border text-brand-text/70 hover:text-brand-text transition-colors"
            >
              <Download size={16} /> Export Excel
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto w-full -mx-6 px-6 sm:mx-0 sm:px-0 custom-scrollbar">
          <div className="overflow-x-auto max-h-[500px] w-full rounded-2xl border border-brand-glass-border custom-scrollbar relative">
            <table className="w-full border-collapse text-left min-w-[800px]">
              <thead className="sticky top-0 bg-brand-card z-10 shadow-sm">
                <tr className="border-b border-brand-glass-border">
                  <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px]">#</th>
                  <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px]">Title</th>
                  <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px]">Category</th>
                  <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px]">Amount</th>
                  <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px]">Date</th>
                  <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px]">Payment</th>
                  <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px]">Vendor</th>
                  <th className="p-4 font-bold text-brand-text/40 uppercase tracking-widest text-[10px] text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                {filteredExpenses.map((exp, index) => (
                  <motion.tr 
                    layout
                    key={exp.id} 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                    style={{ willChange: 'transform, opacity' }}
                    className="border-b border-brand-glass-border/50 hover:bg-brand-secondary/20 transition-colors group"
                  >
                    <td className="p-4 text-brand-text/40 font-medium text-sm">{index + 1}</td>
                    <td className="p-4 font-bold text-sm">{exp.description}</td>
                    <td className="p-4">
                      <span className="bg-brand-secondary/50 text-brand-text/80 px-2.5 py-1 rounded-md text-xs font-semibold">
                        {exp.category || 'Miscellaneous'}
                      </span>
                    </td>
                    <td className="p-4 font-bold text-sm text-brand-primary">₹{exp.amount.toFixed(2)}</td>
                    <td className="p-4 text-brand-text/70 text-sm font-medium">{format(new Date(exp.date), 'dd MMM yyyy')}</td>
                    <td className="p-4 text-brand-text/70 text-sm">{exp.payment_method || '-'}</td>
                    <td className="p-4 text-brand-text/70 text-sm">{exp.vendor || '-'}</td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEditModal(exp)} className="btn-icon text-brand-text/50 hover:text-brand-text hover:bg-brand-secondary"><Edit2 size={14} /></button>
                        <button onClick={() => setDeletingId(exp.id)} className="btn-icon text-brand-danger/70 hover:bg-brand-danger/10 hover:text-brand-danger"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
            
            <AnimatePresence mode="popLayout">
            {filteredExpenses.length === 0 && (
              <motion.div 
                layout
                key="empty"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                className="flex flex-col items-center justify-center py-16 text-center"
              >
                <div className="w-16 h-16 bg-brand-secondary/20 rounded-full flex items-center justify-center mb-4 text-brand-primary">
                  <DollarSign size={24} />
                </div>
                <h3 className="text-lg font-bold text-brand-text mb-1">No expenses found</h3>
                <p className="text-brand-text/50 text-sm">Try adjusting your filters or add a new expense.</p>
              </motion.div>
            )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Sidebar (Charts) */}
        <div className="flex flex-col gap-6">
          <div 
            className="glass p-6 rounded-2xl border border-brand-glass-border animate-slide-up"
            style={{ animationFillMode: 'both', animationDelay: '100ms' }}
          >
            <h3 className="text-sm font-bold text-brand-text/40 uppercase tracking-widest mb-6">Expense Categories</h3>
            {categoryData.length > 0 ? (
              <div className="h-[250px] w-full relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryData}
                      innerRadius={65}
                      outerRadius={85}
                      paddingAngle={5}
                      dataKey="value"
                      stroke="none"
                    >
                      {categoryData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      formatter={(value) => `₹${value.toFixed(2)}`}
                      contentStyle={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--glass-border)', borderRadius: '12px', color: 'var(--text-color)', fontWeight: 'bold' }}
                      itemStyle={{ color: 'var(--text-color)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center total text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xs font-bold text-brand-text/40 uppercase tracking-widest">Total</span>
                  <span className="text-xl font-black">₹{categoryData.reduce((a,b)=>a+b.value,0).toFixed(0)}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-brand-text/30 font-medium text-sm">
                No data to chart
              </div>
            )}

            {/* Custom Legend */}
            <div className="mt-4 flex flex-col gap-2 max-h-[250px] overflow-y-auto custom-scrollbar pr-2">
              {categoryData.map((entry, idx) => (
                <div key={entry.name} className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
                    <span className="font-medium text-brand-text/70 truncate">{entry.name}</span>
                  </div>
                  <span className="font-bold text-brand-text">₹{entry.value.toFixed(0)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Add Expense Modal */}
      {createPortal(
        <AnimatePresence>
      {isAddOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={resetForm}></motion.div>
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 10 }} 
            animate={{ opacity: 1, scale: 1, y: 0 }} 
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-brand-bg border border-brand-glass-border rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden z-10 relative"
          >
            <div className="flex justify-between items-center p-6 border-b border-brand-glass-border">
              <h2 className="text-xl font-bold">{editingId ? 'Edit Expense' : 'Add Expense'}</h2>
              <button className="text-brand-text/50 hover:text-brand-text transition-colors" onClick={resetForm}>
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Title */}
                <div>
                  <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Title *</label>
                  <input type="text" className="w-full bg-brand-card border border-brand-glass-border rounded-xl px-4 py-2.5 text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors" placeholder="e.g. Milk" value={title} onChange={e => setTitle(e.target.value)} />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Category *</label>
                  <div className="relative">
                    <select className="w-full bg-brand-card border border-brand-glass-border rounded-xl pl-4 pr-10 py-2.5 appearance-none text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors" value={category} onChange={e => setCategory(e.target.value)}>
                      {CATEGORIES.map(cat => <option key={cat}>{cat}</option>)}
                    </select>
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                      <ChevronDown size={16} className="text-brand-text/40" />
                    </div>
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Amount *</label>
                  <input type="number" className="w-full bg-brand-card border border-brand-glass-border rounded-xl px-4 py-2.5 text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
                </div>

                {/* Date */}
                <div>
                  <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Date *</label>
                  <div className="relative">
                    <input type="date" className="w-full bg-brand-card border border-brand-glass-border rounded-xl px-4 py-2.5 text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:hover:opacity-100" value={date} onChange={e => setDate(e.target.value)} />
                  </div>
                </div>

                {/* Payment Method */}
                <div>
                  <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Payment Method</label>
                  <div className="relative">
                    <select className="w-full bg-brand-card border border-brand-glass-border rounded-xl pl-4 pr-10 py-2.5 appearance-none text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                      {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
                    </select>
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                      <ChevronDown size={16} className="text-brand-text/40" />
                    </div>
                  </div>
                </div>

                {/* Vendor */}
                <div>
                  <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Vendor</label>
                  <input type="text" className="w-full bg-brand-card border border-brand-glass-border rounded-xl px-4 py-2.5 text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors" placeholder="Optional" value={vendor} onChange={e => setVendor(e.target.value)} />
                </div>

                {/* Notes */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Notes</label>
                  <textarea className="w-full bg-brand-card border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors resize-none h-24" placeholder="Any additional notes..." value={notes} onChange={e => setNotes(e.target.value)}></textarea>
                </div>

              </div>
            </div>

            <div className="p-6 border-t border-brand-glass-border bg-brand-card/50 flex justify-end gap-3">
              <button className="btn btn-secondary border border-brand-glass-border hover:bg-brand-secondary/80 font-semibold" onClick={resetForm}>Cancel</button>
              <button className="btn bg-brand-primary text-white hover:bg-brand-primary/90 font-bold px-6" onClick={handleAdd}>{editingId ? 'Update Expense' : 'Save Expense'}</button>
            </div>
          </motion.div>
        </div>
      )}
      </AnimatePresence>,
      document.body
      )}

      {/* Delete Confirmation Modal */}
      {createPortal(
        <AnimatePresence>
      {deletingId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeletingId(null)}></motion.div>
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 10 }} 
            animate={{ opacity: 1, scale: 1, y: 0 }} 
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-brand-bg border border-brand-glass-border rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden z-10 relative"
          >
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-brand-danger/10 rounded-full flex items-center justify-center mx-auto mb-4 text-brand-danger">
                <Trash2 size={24} />
              </div>
              <h3 className="text-xl font-bold text-brand-text mb-2">Delete Expense?</h3>
              <p className="text-brand-text/60 text-sm mb-6">Are you sure you want to delete this expense? This action cannot be undone.</p>
              
              <div className="flex gap-3">
                <button className="btn btn-secondary flex-1 border border-brand-glass-border hover:bg-brand-secondary/80 font-semibold" onClick={() => setDeletingId(null)}>Cancel</button>
                <button className="btn bg-brand-danger text-white hover:bg-brand-danger/90 font-bold flex-1" onClick={confirmDelete}>Yes, Delete</button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
      </AnimatePresence>,
      document.body
      )}

    </div>
  );
}
