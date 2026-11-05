import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Search, Download, Edit2, Trash2, Users, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('All Status');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [deletingItem, setDeletingItem] = useState(null);

  const fetchEmployees = useCallback(async () => {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('full_name');
    if (!error) setEmployees(data || []);
  }, []);

  useEffect(() => {
    fetchEmployees();

    const sub = supabase
      .channel('employees_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, fetchEmployees)
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, [fetchEmployees]);

  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      const matchesSearch = emp.full_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            emp.position.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = selectedStatus === 'All Status' || emp.status === selectedStatus;
      return matchesSearch && matchesStatus;
    });
  }, [employees, searchQuery, selectedStatus]);

  const handleExportExcel = () => {
    if (filteredEmployees.length === 0) return toast.error("No employees to export");
    const headers = ['Full Name', 'Position', 'Phone', 'Email', 'Monthly Salary', 'Joining Date', 'Status', 'Address', 'Notes'];
    const csvContent = [
      headers.join(','),
      ...filteredEmployees.map(emp => 
        [
          `"${emp.full_name || ''}"`, 
          `"${emp.position || ''}"`, 
          `"${emp.phone || ''}"`, 
          `"${emp.email || ''}"`, 
          emp.monthly_salary, 
          `"${emp.joining_date || ''}"`, 
          `"${emp.status || ''}"`, 
          `"${(emp.address || '').replace(/"/g, '""')}"`,
          `"${(emp.notes || '').replace(/"/g, '""')}"`
        ].join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `employees_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    toast.success('Employees exported successfully!');
  };

  const confirmDelete = async () => {
    if (!deletingItem) return;
    const { error } = await supabase.from('employees').delete().eq('id', deletingItem.id);
    if (error) {
      toast.error('Failed to delete employee: ' + error.message);
    } else {
      toast.success('Employee deleted');
      fetchEmployees();
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
          <h2 className="text-3xl font-black text-brand-text mb-1">Employees</h2>
          <p className="text-sm font-medium text-brand-text/50">Manage your team</p>
        </div>
        <button 
          className="bg-brand-primary hover:bg-brand-accent text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors shadow-lg shadow-brand-primary/20"
          onClick={() => { setEditingItem(null); setIsModalOpen(true); }}
        >
          <Plus size={16} /> Add Employee
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-brand-card rounded-2xl border border-brand-glass-border p-4 flex flex-col md:flex-row gap-4 mb-6 shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-primary" />
          <input 
            type="text" 
            placeholder="Search employees..." 
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
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
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
        <div className="overflow-x-auto w-full no-scrollbar">
          <div className="min-w-[800px] flex flex-col h-full">
            <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-brand-glass-border bg-brand-bg/30 text-[10px] font-black text-brand-text/40 tracking-widest uppercase">
              <div className="col-span-1">#</div>
              <div className="col-span-2">Name</div>
              <div className="col-span-2">Position</div>
              <div className="col-span-2">Phone</div>
              <div className="col-span-2">Email</div>
              <div className="col-span-1">Salary</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>

        <div className="flex-1 overflow-y-auto p-2 no-scrollbar relative">
          <AnimatePresence mode="popLayout">
            {filteredEmployees.length === 0 ? (
              <motion.div 
                layout
                key="empty"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                className="absolute inset-0 flex flex-col items-center justify-center text-brand-text/40 font-medium"
              >
                <Users size={48} className="mb-4 opacity-30" />
                <p>No employees found</p>
              </motion.div>
            ) : (
              filteredEmployees.map((emp, index) => (
                <motion.div
                  layout
                  key={emp.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                  className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-brand-glass-border/30 items-center hover:bg-brand-secondary/10 transition-colors rounded-xl mx-2 mb-1"
                >
                  <div className="col-span-1 text-xs font-bold text-brand-text/40">{index + 1}</div>
                  <div className="col-span-2 text-sm font-bold text-brand-text truncate">{emp.full_name}</div>
                  <div className="col-span-2 text-xs font-medium text-brand-text/60 truncate">{emp.position}</div>
                  <div className="col-span-2 text-xs font-medium text-brand-text/60">{emp.phone || '-'}</div>
                  <div className="col-span-2 text-xs font-medium text-brand-text/60 truncate">{emp.email || '-'}</div>
                  <div className="col-span-1 text-xs font-bold text-brand-text">₹{emp.monthly_salary.toLocaleString('en-IN')}<span className="text-[10px] text-brand-text/40 font-medium ml-0.5">/mo</span></div>
                  <div className="col-span-1">
                    {emp.status === 'Active' ? (
                      <span className="text-[10px] font-bold uppercase tracking-widest text-green-500">Active</span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-widest text-brand-text/40">Inactive</span>
                    )}
                  </div>
                  <div className="col-span-1 flex justify-end gap-2">
                    <button className="p-1.5 text-brand-text/50 hover:text-blue-500 hover:bg-blue-500/10 rounded-lg transition-colors" onClick={() => openEditModal(emp)}>
                      <Edit2 size={16} />
                    </button>
                    <button className="p-1.5 text-brand-text/50 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors" onClick={() => setDeletingItem(emp)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <EmployeeModal 
            employee={editingItem} 
            onClose={() => setIsModalOpen(false)} 
            refresh={fetchEmployees} 
          />
        )}
        
        {deletingItem && (
          <DeleteConfirmModal 
            title="Delete Employee?"
            message={`Are you sure you want to delete ${deletingItem.full_name}? This will also delete all their salary records. This action cannot be undone.`}
            onCancel={() => setDeletingItem(null)} 
            onConfirm={confirmDelete} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function EmployeeModal({ employee, onClose, refresh }) {
  const isEdit = !!employee;
  const [formData, setFormData] = useState({
    full_name: employee?.full_name || '',
    position: employee?.position || '',
    phone: employee?.phone || '',
    email: employee?.email || '',
    monthly_salary: employee?.monthly_salary || '',
    joining_date: employee?.joining_date || format(new Date(), 'yyyy-MM-dd'),
    status: employee?.status || 'Active',
    address: employee?.address || '',
    notes: employee?.notes || ''
  });

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.full_name || !formData.position) return toast.error("Name and Position are required");
    
    const payload = {
      ...formData,
      monthly_salary: Number(formData.monthly_salary) || 0,
    };

    if (isEdit) {
      const { error } = await supabase.from('employees').update(payload).eq('id', employee.id);
      if (error) {
        console.error("Update error:", error);
        return toast.error("Failed to update: " + error.message);
      }
      toast.success("Employee updated successfully");
    } else {
      const { error } = await supabase.from('employees').insert(payload);
      if (error) {
        console.error("Insert error:", error);
        return toast.error("Failed to add employee: " + error.message);
      }
      toast.success("Employee added successfully");
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
        className="bg-brand-card rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden z-10 relative border border-brand-glass-border/50"
      >
        <div className="flex justify-between items-center p-5 border-b border-brand-glass-border bg-brand-bg/50">
          <h2 className="text-xl font-bold text-brand-text flex items-center gap-2">
            <Users size={20} className="text-brand-primary" />
            {isEdit ? 'Edit Employee' : 'Add Employee'}
          </h2>
          <button className="text-brand-text/50 hover:text-brand-text hover:bg-brand-secondary/50 p-1.5 rounded-lg transition-colors" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Full Name *</label>
              <input type="text" name="full_name" placeholder="John Doe" value={formData.full_name} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text" required />
            </div>
            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Position *</label>
              <input type="text" name="position" placeholder="Manager, Chef, Waiter..." value={formData.position} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text" required />
            </div>
            
            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Phone</label>
              <input type="text" name="phone" placeholder="+91 98765 43210" value={formData.phone} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text" />
            </div>
            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Email</label>
              <input type="email" name="email" placeholder="john@example.com" value={formData.email} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text" />
            </div>

            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Monthly Salary (₹) *</label>
              <input type="number" step="0.01" name="monthly_salary" placeholder="0" value={formData.monthly_salary} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text" required />
            </div>
            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Joining Date</label>
              <input type="date" name="joining_date" value={formData.joining_date} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text style-color-scheme-dark" />
            </div>

            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Status</label>
              <select name="status" value={formData.status} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text appearance-none">
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Address</label>
              <input type="text" name="address" placeholder="123 Main St..." value={formData.address} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text" />
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Notes</label>
            <textarea name="notes" rows="2" placeholder="Any additional notes..." value={formData.notes} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text resize-none" />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-brand-glass-border">
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-bold text-brand-text/70 bg-brand-secondary/30 hover:bg-brand-secondary/50 rounded-xl transition-colors">
              Cancel
            </button>
            <button type="submit" className="px-5 py-2.5 text-sm font-bold text-white bg-brand-primary hover:bg-brand-accent rounded-xl shadow-lg shadow-brand-primary/20 transition-colors">
              Save Employee
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
