import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Search, Download, Edit2, Trash2, CreditCard, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

export default function Salaries() {
  const [salaries, setSalaries] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('All Status');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [deletingItem, setDeletingItem] = useState(null);

  const fetchData = useCallback(async () => {
    // Fetch employees for the dropdown and join
    const { data: empData } = await supabase.from('employees').select('*').order('full_name');
    if (empData) setEmployees(empData);

    // Fetch salaries
    const { data: salData, error } = await supabase
      .from('salaries')
      .select('*, employees(full_name, position)')
      .order('payment_date', { ascending: false });
    if (!error) setSalaries(salData || []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();

    const sub = supabase
      .channel('salaries_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'salaries' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, [fetchData]);

  const filteredSalaries = useMemo(() => {
    return salaries.filter(sal => {
      const empName = sal.employees?.full_name?.toLowerCase() || '';
      const matchesSearch = empName.includes(searchQuery.toLowerCase());
      const matchesStatus = selectedStatus === 'All Status' || sal.status === selectedStatus;
      return matchesSearch && matchesStatus;
    });
  }, [salaries, searchQuery, selectedStatus]);

  const handleExportExcel = () => {
    if (filteredSalaries.length === 0) return toast.error("No records to export");
    const headers = ['Employee', 'Month', 'Year', 'Amount', 'Payment Date', 'Status', 'Remarks'];
    const csvContent = [
      headers.join(','),
      ...filteredSalaries.map(sal => 
        [
          `"${sal.employees?.full_name || ''}"`, 
          `"${sal.month || ''}"`, 
          sal.year, 
          sal.amount, 
          `"${sal.payment_date || ''}"`, 
          `"${sal.status || ''}"`, 
          `"${(sal.remarks || '').replace(/"/g, '""')}"`
        ].join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `salaries_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    toast.success('Salaries exported successfully!');
  };

  const confirmDelete = async () => {
    if (!deletingItem) return;
    const { error } = await supabase.from('salaries').delete().eq('id', deletingItem.id);
    if (error) {
      toast.error('Failed to delete record');
    } else {
      // Remove the mirrored expense too, so deleting a paid salary doesn't leave a
      // permanent phantom expense inflating Expenses/Analytics/Dashboard forever.
      if (deletingItem.expense_id) {
        await supabase.from('expenses').delete().eq('id', deletingItem.expense_id);
      }
      toast.success('Record deleted');
      fetchData();
    }
    setDeletingItem(null);
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-6">
        <div>
          <h2 className="text-3xl font-black text-brand-text mb-1">Salary Management</h2>
          <p className="text-sm font-medium text-brand-text/50">Track salary payments</p>
        </div>
        <button 
          className="bg-brand-primary hover:bg-brand-accent text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors shadow-lg shadow-brand-primary/20"
          onClick={() => { setEditingItem(null); setIsModalOpen(true); }}
        >
          <Plus size={16} /> Record Payment
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-brand-card rounded-2xl border border-brand-glass-border p-4 flex flex-col md:flex-row gap-4 mb-6 shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-primary" />
          <input 
            type="text" 
            placeholder="Search employee..." 
            className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-shadow"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-4">
          <select 
            className="bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm font-bold text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 appearance-none min-w-[160px]"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
          >
            <option value="All Status">All Status</option>
            <option value="Paid">Paid</option>
            <option value="Pending">Pending</option>
          </select>
          
          <button 
            className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold text-brand-text/70 bg-brand-secondary/30 hover:bg-brand-secondary/50 rounded-xl border border-brand-glass-border transition-colors ml-auto"
            onClick={handleExportExcel}
          >
            <Download size={14} /> Export Excel
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="flex-1 overflow-hidden flex flex-col bg-brand-card border border-brand-glass-border rounded-2xl shadow-sm">
        <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-brand-glass-border bg-brand-bg/30 text-[10px] font-black text-brand-text/40 tracking-widest uppercase">
          <div className="col-span-1">#</div>
          <div className="col-span-2">Employee</div>
          <div className="col-span-1">Month</div>
          <div className="col-span-1">Year</div>
          <div className="col-span-2">Amount</div>
          <div className="col-span-2">Payment Date</div>
          <div className="col-span-1">Status</div>
          <div className="col-span-1">Remarks</div>
          <div className="col-span-1 text-right">Actions</div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 no-scrollbar relative">
          <AnimatePresence mode="popLayout">
            {filteredSalaries.length === 0 ? (
              <motion.div 
                layout
                key="empty"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                className="absolute inset-0 flex flex-col items-center justify-center text-brand-text/40 font-medium"
              >
                <CreditCard size={48} className="mb-4 opacity-30" />
                <p>No salary records found</p>
              </motion.div>
            ) : (
              filteredSalaries.map((sal, index) => (
                <motion.div
                  layout
                  key={sal.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                  className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-brand-glass-border/30 items-center hover:bg-brand-secondary/10 transition-colors rounded-xl mx-2 mb-1"
                >
                  <div className="col-span-1 text-xs font-bold text-brand-text/40">{index + 1}</div>
                  <div className="col-span-2 text-sm font-bold text-brand-text truncate">{sal.employees?.full_name}</div>
                  <div className="col-span-1 text-xs font-medium text-brand-text/60">{sal.month}</div>
                  <div className="col-span-1 text-xs font-medium text-brand-text/60">{sal.year}</div>
                  <div className="col-span-2 text-xs font-bold text-brand-text">₹{sal.amount.toLocaleString('en-IN')}</div>
                  <div className="col-span-2 text-xs font-medium text-brand-text/60">{sal.payment_date}</div>
                  <div className="col-span-1">
                    {sal.status === 'Paid' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-green-500/10 text-green-500">
                        Paid
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-yellow-500/10 text-yellow-500">
                        Pending
                      </span>
                    )}
                  </div>
                  <div className="col-span-1 text-xs font-medium text-brand-text/60 truncate">{sal.remarks || '-'}</div>
                  <div className="col-span-1 flex justify-end gap-2">
                    <button className="p-1.5 text-brand-text/50 hover:text-blue-500 hover:bg-blue-500/10 rounded-lg transition-colors" onClick={() => openEditModal(sal)}>
                      <Edit2 size={16} />
                    </button>
                    <button className="p-1.5 text-brand-text/50 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors" onClick={() => setDeletingItem(sal)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <SalaryModal 
            record={editingItem} 
            employees={employees}
            onClose={() => setIsModalOpen(false)} 
            refresh={fetchData} 
          />
        )}
        
        {deletingItem && (
          <DeleteConfirmModal 
            title="Delete Salary Record?"
            message={`Are you sure you want to delete the salary record for ${deletingItem.employees?.full_name}?`}
            onCancel={() => setDeletingItem(null)} 
            onConfirm={confirmDelete} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SalaryModal({ record, employees, onClose, refresh }) {
  const isEdit = !!record;
  const currentMonth = format(new Date(), 'MMMM');
  const currentYear = new Date().getFullYear();

  const [formData, setFormData] = useState(() => {
    const defaultEmpId = employees.length > 0 ? employees[0].id : '';
    const defaultEmp = employees.length > 0 ? employees[0] : null;
    return {
      employee_id: record?.employee_id || defaultEmpId,
      month: record?.month || currentMonth,
      year: record?.year || currentYear.toString(),
      amount: record?.amount || (record ? '' : (defaultEmp?.monthly_salary || '')),
      payment_date: record?.payment_date || format(new Date(), 'yyyy-MM-dd'),
      status: record?.status || 'Paid',
      remarks: record?.remarks || ''
    };
  });

  // When employee changes, automatically fill out the amount based on their salary
  const handleEmployeeChange = (e) => {
    const empId = e.target.value;
    const emp = employees.find(emp => emp.id === empId);
    setFormData(prev => ({
      ...prev,
      employee_id: empId,
      amount: emp ? emp.monthly_salary : prev.amount
    }));
  };

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.employee_id) return toast.error("Please select an employee");
    if (!formData.amount) return toast.error("Amount is required");

    const payload = {
      ...formData,
      amount: Number(formData.amount) || 0,
      year: Number(formData.year) || currentYear
    };

    const emp = employees.find(e => e.id === formData.employee_id);
    const empName = emp ? emp.full_name : 'Employee';
    const expensePayload = {
      description: `Salary: ${empName} - ${payload.month} ${payload.year}`,
      amount: payload.amount,
      category: 'Salary',
      date: new Date(payload.payment_date).toISOString(),
      payment_method: 'Online/UPI',
      notes: payload.remarks
    };

    // A Paid salary auto-creates a mirrored expense row; keep them in sync via expense_id
    // instead of leaving orphaned/stale expenses behind when a record is edited or un-marked.
    if (isEdit) {
      let expenseId = record.expense_id || null;

      if (payload.status === 'Paid') {
        if (expenseId) {
          await supabase.from('expenses').update(expensePayload).eq('id', expenseId);
        } else {
          const { data: exp, error: expError } = await supabase.from('expenses').insert(expensePayload).select().single();
          if (!expError) expenseId = exp.id;
        }
      } else if (expenseId) {
        await supabase.from('expenses').delete().eq('id', expenseId);
        expenseId = null;
      }

      const { error } = await supabase.from('salaries').update({ ...payload, expense_id: expenseId }).eq('id', record.id);
      if (error) return toast.error("Failed to update record: " + error.message);

      toast.success("Payment updated");
    } else {
      let expenseId = null;
      if (payload.status === 'Paid') {
        const { data: exp, error: expError } = await supabase.from('expenses').insert(expensePayload).select().single();
        if (!expError) expenseId = exp.id;
      }

      const { error } = await supabase.from('salaries').insert({ ...payload, expense_id: expenseId });
      if (error) return toast.error("Failed to record payment: " + error.message);

      toast.success("Payment recorded!");
    }

    refresh();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></motion.div>
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-brand-card rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden z-10 relative border border-brand-glass-border/50"
      >
        <div className="flex justify-between items-center p-5 border-b border-brand-glass-border bg-brand-bg/50">
          <h2 className="text-xl font-bold text-brand-text flex items-center gap-2">
            <CreditCard size={20} className="text-brand-primary" />
            {isEdit ? 'Edit Salary Record' : 'Record Salary Payment'}
          </h2>
          <button className="text-brand-text/50 hover:text-brand-text hover:bg-brand-secondary/50 p-1.5 rounded-lg transition-colors" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6">
          <div className="mb-5">
            <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Employee *</label>
            <select name="employee_id" value={formData.employee_id} onChange={handleEmployeeChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text appearance-none" required disabled={employees.length === 0}>
              {employees.length === 0 ? <option value="">No employees found</option> : null}
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.full_name} — {emp.position}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Month</label>
              <select name="month" value={formData.month} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text appearance-none">
                {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Year</label>
              <input type="number" name="year" value={formData.year} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text" required />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Amount (₹) *</label>
              <input type="number" step="0.01" name="amount" placeholder="0" value={formData.amount} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text" required />
            </div>
            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Payment Date</label>
              <input type="date" name="payment_date" value={formData.payment_date} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text style-color-scheme-dark" />
            </div>
          </div>

          <div className="mb-5">
            <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Status</label>
            <select name="status" value={formData.status} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text appearance-none">
              <option value="Paid">Paid</option>
              <option value="Pending">Pending</option>
            </select>
          </div>

          <div className="mb-6">
            <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Remarks</label>
            <textarea name="remarks" rows="2" placeholder="Bonus, deductions, etc..." value={formData.remarks} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text resize-none" />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-brand-glass-border">
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-bold text-brand-text/70 bg-brand-secondary/30 hover:bg-brand-secondary/50 rounded-xl transition-colors">
              Cancel
            </button>
            <button type="submit" className="px-5 py-2.5 text-sm font-bold text-white bg-brand-primary hover:bg-brand-accent rounded-xl shadow-lg shadow-brand-primary/20 transition-colors">
              Save Record
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function DeleteConfirmModal({ title, message, onCancel, onConfirm }) {
    return (
        <div className="fixed inset-0 z-[110] bg-brand-bg/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
            transition={{ duration: 0.2 }}
            className="bg-brand-card border border-brand-danger/20 w-full max-w-sm rounded-3xl shadow-2xl flex flex-col overflow-hidden text-center" 
            onClick={e => e.stopPropagation()}
          >
              <div className="p-8 pb-6 flex flex-col items-center">
                  <div className="w-16 h-16 bg-brand-danger/10 text-brand-danger rounded-full flex items-center justify-center mb-6 shadow-inner">
                      <Trash2 size={32} />
                  </div>
                  <h3 className="text-xl font-bold text-brand-text mb-2">{title || 'Delete Record?'}</h3>
                  <p className="text-sm text-brand-text/60">
                      {message || 'Are you sure you want to delete this record? This action cannot be undone.'}
                  </p>
              </div>
              <div className="p-6 pt-0 flex gap-3">
                  <button className="flex-1 bg-brand-bg hover:bg-brand-secondary/50 border border-brand-glass-border text-brand-text font-bold py-3 rounded-xl transition-colors" onClick={onCancel}>Cancel</button>
                  <button className="flex-1 bg-brand-danger hover:bg-red-600 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-brand-danger/30" onClick={onConfirm}>Delete</button>
              </div>
          </motion.div>
        </div>
    );
}
