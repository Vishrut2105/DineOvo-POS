import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Search, Store, Download, X, Edit3, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';

export default function Vendors() {
  const [vendors, setVendors] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState(null);
  const [deletingVendor, setDeletingVendor] = useState(null);
  
  // Form State
  const [formData, setFormData] = useState({
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: '',
    products: '',
    outstanding_amount: '0',
    notes: ''
  });

  const fetchVendors = useCallback(async () => {
    const { data, error } = await supabase
      .from('vendors')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error) setVendors(data || []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchVendors();

    const sub = supabase
      .channel('vendors_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendors' }, fetchVendors)
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, [fetchVendors]);

  const filteredVendors = useMemo(() => {
    return vendors.filter(v => {
      const q = searchQuery.toLowerCase();
      return (v.name && v.name.toLowerCase().includes(q)) || 
             (v.contact_person && v.contact_person.toLowerCase().includes(q)) ||
             (v.phone && v.phone.includes(q)) ||
             (v.products && v.products.toLowerCase().includes(q));
    });
  }, [vendors, searchQuery]);

  const handleOpenModal = (vendor = null) => {
    if (vendor) {
      setEditingVendor(vendor);
      setFormData({
        name: vendor.name || '',
        contact_person: vendor.contact_person || '',
        phone: vendor.phone || '',
        email: vendor.email || '',
        address: vendor.address || '',
        products: vendor.products || '',
        outstanding_amount: vendor.outstanding_amount?.toString() || '0',
        notes: vendor.notes || ''
      });
    } else {
      setEditingVendor(null);
      setFormData({
        name: '',
        contact_person: '',
        phone: '',
        email: '',
        address: '',
        products: '',
        outstanding_amount: '0',
        notes: ''
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingVendor(null);
  };

  const handleSaveVendor = async () => {
    if (!formData.name) {
      toast.error('Vendor Name is required');
      return;
    }

    const payload = {
      ...formData,
      outstanding_amount: parseFloat(formData.outstanding_amount || 0)
    };

    if (editingVendor) {
      const { error } = await supabase.from('vendors').update(payload).eq('id', editingVendor.id);
      if (error) {
        console.error('Update Vendor Error:', error);
        toast.error(`Failed to update vendor: ${error.message}`);
      } else {
        toast.success('Vendor updated successfully');
        handleCloseModal();
      }
    } else {
      const { error } = await supabase.from('vendors').insert([payload]);
      if (error) {
        console.error('Insert Vendor Error:', error);
        toast.error(`Failed to add vendor: ${error.message}`);
      } else {
        toast.success('Vendor added successfully');
        handleCloseModal();
      }
    }
  };

  const confirmDelete = async () => {
    if (!deletingVendor) return;
    const { error } = await supabase.from('vendors').delete().eq('id', deletingVendor.id);
    if (error) {
      toast.error('Failed to delete vendor');
    } else {
      toast.success('Vendor deleted');
    }
    setDeletingVendor(null);
  };

  const handleExportExcel = () => {
    if (filteredVendors.length === 0) return toast.error('No vendors to export');

    const headers = ['Name', 'Contact Person', 'Phone', 'Email', 'Address', 'Products', 'Outstanding Amount', 'Notes'];
    const formatCell = (cell) => (
      typeof cell === 'number' ? String(cell) : `"${String(cell ?? '').replace(/"/g, '""')}"`
    );
    const rows = filteredVendors.map(v => [
      v.name, v.contact_person || '-', v.phone || '-', v.email || '-',
      v.address || '-', v.products || '-', v.outstanding_amount || 0, v.notes || '-'
    ]);
    const csvContent = [headers.join(','), ...rows.map(row => row.map(formatCell).join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `vendors_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    toast.success('Vendors exported successfully!');
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-6">
        <div>
          <h2 className="text-3xl font-black text-brand-text mb-1 flex items-center gap-2">
            Vendors
          </h2>
          <p className="text-sm font-medium text-brand-text/50">Manage suppliers and outstanding payments</p>
        </div>
        <button 
          onClick={() => handleOpenModal()} 
          className="bg-brand-primary text-white font-bold px-4 py-2 rounded-xl text-sm shadow-lg shadow-brand-primary/20 hover:bg-brand-accent transition-colors flex items-center gap-2"
        >
          <Plus size={16} /> Add Vendor
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-brand-card rounded-2xl border border-brand-glass-border p-4 flex flex-col md:flex-row gap-4 mb-6 shadow-sm items-center">
        <div className="relative flex-1 max-w-md w-full">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-primary" />
          <input 
            type="text" 
            placeholder="Search vendors..." 
            className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-shadow"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <button 
          onClick={handleExportExcel}
          className="flex items-center gap-2 px-4 py-2.5 border border-brand-glass-border rounded-xl text-sm font-bold text-brand-text/70 hover:bg-brand-secondary/30 transition-colors w-full md:w-auto justify-center"
        >
          <Download size={16} /> Export Excel
        </button>
      </div>

      {/* Main Table */}
      <div className="flex-1 overflow-hidden flex flex-col bg-brand-card border border-brand-glass-border rounded-2xl shadow-sm">
        <div className="overflow-x-auto w-full no-scrollbar flex-1 flex flex-col h-full">
          <div className="min-w-[900px] flex flex-col h-full">
            <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-brand-glass-border bg-brand-bg/30 text-[10px] font-black text-brand-text/40 tracking-widest uppercase">
              <div className="col-span-1">#</div>
              <div className="col-span-3">VENDOR</div>
              <div className="col-span-2">CONTACT</div>
              <div className="col-span-2">PHONE</div>
              <div className="col-span-2">PRODUCTS</div>
              <div className="col-span-1 text-right">OUTSTANDING</div>
              <div className="col-span-1 text-right">ACTIONS</div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 no-scrollbar relative">
              <AnimatePresence mode="popLayout">
                {filteredVendors.length === 0 ? (
                  <motion.div 
                    layout
                    key="empty"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                    className="absolute inset-0 flex flex-col items-center justify-center text-brand-text/40 font-medium"
                  >
                    <Store size={48} className="mb-4 opacity-30" />
                    <p>No vendors yet</p>
                  </motion.div>
                ) : (
                  filteredVendors.map((v, index) => (
                    <motion.div
                      layout
                      key={v.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                      className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-brand-glass-border/30 items-center hover:bg-brand-secondary/10 transition-colors rounded-xl mx-2 mb-1"
                    >
                      <div className="col-span-1 text-xs font-bold text-brand-text/40">{index + 1}</div>
                      <div className="col-span-3 text-sm font-bold text-brand-text truncate">{v.name}</div>
                      <div className="col-span-2 text-xs font-medium text-brand-text/80 truncate">{v.contact_person || '-'}</div>
                      <div className="col-span-2 text-xs font-medium text-brand-text/80">{v.phone || '-'}</div>
                      <div className="col-span-2 text-xs font-medium text-brand-text/60 truncate">{v.products || '-'}</div>
                      <div className="col-span-1 text-right font-black text-brand-primary text-sm">₹{Number(v.outstanding_amount).toLocaleString()}</div>
                      <div className="col-span-1 flex items-center justify-end gap-2">
                        <button onClick={() => handleOpenModal(v)} className="p-1.5 text-brand-text/50 hover:text-brand-primary hover:bg-brand-primary/10 rounded-lg transition-colors">
                          <Edit3 size={14} />
                        </button>
                        <button onClick={() => setDeletingVendor(v)} className="p-1.5 text-brand-text/50 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors">
                          <Trash2 size={14} />
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

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-brand-bg border border-brand-glass-border rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="flex justify-between items-center p-4 lg:p-6 border-b border-brand-glass-border bg-brand-card">
              <h3 className="font-bold text-lg text-brand-text">{editingVendor ? 'Edit Vendor' : 'Add Vendor'}</h3>
              <button onClick={handleCloseModal} className="p-2 text-brand-text/50 hover:text-brand-text hover:bg-brand-secondary/50 rounded-xl transition-colors">
                <X size={18} />
              </button>
            </div>
            
            <div className="p-4 lg:p-6 overflow-y-auto flex-col flex gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Vendor Name *</label>
                  <input type="text" placeholder="Business name" className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary/50" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                </div>
                <div>
                  <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Contact Person</label>
                  <input type="text" placeholder="Contact name" className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary/50" value={formData.contact_person} onChange={e => setFormData({...formData, contact_person: e.target.value})} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Phone</label>
                  <input type="text" placeholder="+91 XXXXX XXXXX" className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary/50" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Email</label>
                  <input type="email" placeholder="vendor@example.com" className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary/50" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Address</label>
                <input type="text" placeholder="Vendor address" className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary/50" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} />
              </div>

              <div>
                <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Products Supplied</label>
                <input type="text" placeholder="Tea, Milk, Sugar..." className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary/50" value={formData.products} onChange={e => setFormData({...formData, products: e.target.value})} />
              </div>

              <div>
                <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Outstanding Amount (₹)</label>
                <input type="number" placeholder="0" className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary/50" value={formData.outstanding_amount} onChange={e => setFormData({...formData, outstanding_amount: e.target.value})} />
              </div>

              <div>
                <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Notes</label>
                <textarea rows={3} className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary/50 resize-none" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} />
              </div>
            </div>

            <div className="p-4 lg:p-6 border-t border-brand-glass-border bg-brand-card flex justify-end gap-3">
              <button onClick={handleCloseModal} className="px-4 py-2.5 rounded-xl text-sm font-bold text-brand-text/70 hover:bg-brand-secondary/50 transition-colors">
                Cancel
              </button>
              <button onClick={handleSaveVendor} className="px-6 py-2.5 bg-brand-primary text-white rounded-xl text-sm font-bold shadow-lg shadow-brand-primary/20 hover:bg-brand-accent transition-colors">
                {editingVendor ? 'Save Changes' : 'Save Vendor'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      <AnimatePresence>
        {deletingVendor && (
          <DeleteConfirmModal 
            title="Delete Vendor?"
            message={`Are you sure you want to delete ${deletingVendor.name}? This action cannot be undone.`}
            onCancel={() => setDeletingVendor(null)} 
            onConfirm={confirmDelete} 
          />
        )}
      </AnimatePresence>
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
