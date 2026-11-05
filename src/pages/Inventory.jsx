import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { Plus, Search, Download, Edit2, Trash2, PackageOpen, AlertTriangle, CheckCircle, Package, X, Bell } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

export default function Inventory() {
  const [inventory, setInventory] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [isLowStockOpen, setIsLowStockOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);

  const categories = ['All Categories', 'Beverages', 'Food', 'Packaging', 'Cleaning', 'Equipment', 'Other'];

  const lowStockItems = useMemo(() => inventory.filter(i => i.quantity <= i.min_stock), [inventory]);
  const hasOutOfStock = lowStockItems.some(i => i.quantity <= 0);

  const fetchInventory = useCallback(async () => {
    const { data, error } = await supabase
      .from('inventory')
      .select('id, name, category, quantity, unit, min_stock, cost_price, selling_price, supplier, notes, created_at')
      .order('name');
    if (!error) setInventory(data || []);
  }, []);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const filteredInventory = useMemo(() => {
    return inventory.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === 'All Categories' || item.category === selectedCategory;
      const matchesLowStock = lowStockOnly ? item.quantity <= item.min_stock : true;
      return matchesSearch && matchesCategory && matchesLowStock;
    });
  }, [inventory, searchQuery, selectedCategory, lowStockOnly]);

  const handleExportExcel = () => {
    if (filteredInventory.length === 0) return toast.error("No items to export");
    const headers = ['Name', 'Category', 'Quantity', 'Unit', 'Min Stock', 'Cost Price', 'Selling Price', 'Supplier', 'Date Added', 'Notes'];
    const csvContent = [
      headers.join(','),
      ...filteredInventory.map(item => 
        [
          `"${item.name || ''}"`, 
          `"${item.category || ''}"`, 
          item.quantity, 
          `"${item.unit || ''}"`, 
          item.min_stock, 
          item.cost_price, 
          item.selling_price || 0, 
          `"${item.supplier || ''}"`, 
          `"${item.date_added || ''}"`,
          `"${(item.notes || '').replace(/"/g, '""')}"`
        ].join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `inventory_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    toast.success('Inventory exported successfully!');
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    const { error } = await supabase.from('inventory').delete().eq('id', itemToDelete.id);
    if (error) {
      toast.error('Failed to delete item');
    } else {
      toast.success('Item deleted');
      fetchInventory();
    }
    setItemToDelete(null);
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
          <h2 className="text-3xl font-black text-brand-text mb-1">Inventory</h2>
          <p className="text-sm font-medium text-brand-text/50">Track stock levels and manage supplies</p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative">
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
            onClick={() => { setEditingItem(null); setIsModalOpen(true); }}
          >
            <Plus size={16} /> Add Item
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-brand-card rounded-2xl border border-brand-glass-border p-4 flex flex-col md:flex-row gap-4 mb-6 shadow-sm">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-primary" />
          <input 
            type="text" 
            placeholder="Search inventory..." 
            className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-shadow"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-4">
          <select 
            className="bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm font-bold text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 appearance-none min-w-[160px]"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
          
          <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-brand-text hover:text-brand-primary transition-colors">
            <input 
              type="checkbox" 
              className="w-4 h-4 rounded bg-brand-bg border-brand-glass-border text-brand-primary focus:ring-brand-primary/50 cursor-pointer"
              checked={lowStockOnly}
              onChange={(e) => setLowStockOnly(e.target.checked)}
            />
            Low stock only
          </label>

          <button 
            className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold text-brand-text/70 bg-brand-secondary/30 hover:bg-brand-secondary/50 rounded-xl border border-brand-glass-border transition-colors"
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
          <div className="col-span-3">Item</div>
          <div className="col-span-1">Category</div>
          <div className="col-span-1">Unit</div>
          <div className="col-span-1">Cost</div>
          <div className="col-span-1">Selling</div>
          <div className="col-span-1">Min</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-1 text-right">Actions</div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 no-scrollbar relative">
          <AnimatePresence mode="popLayout">
            {filteredInventory.length === 0 ? (
              <motion.div 
                layout
                key="empty"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                className="absolute inset-0 flex flex-col items-center justify-center text-brand-text/40 font-medium"
              >
                <PackageOpen size={48} className="mb-4 opacity-30" />
                <p>No inventory items</p>
              </motion.div>
            ) : (
              filteredInventory.map((item, index) => (
                <motion.div
                  layout
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                  style={{ willChange: 'transform, opacity' }}
                  className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-brand-glass-border/30 items-center hover:bg-brand-secondary/10 transition-colors rounded-xl mx-2 mb-1"
                >
                  <div className="col-span-1 text-xs font-bold text-brand-text/40">{index + 1}</div>
                  <div className="col-span-3 text-sm font-bold text-brand-text truncate">{item.name}</div>
                  <div className="col-span-1 text-xs font-medium text-brand-text/60">{item.category}</div>
                  <div className="col-span-1 text-xs font-medium text-brand-text/60">{item.quantity} {item.unit}</div>
                  <div className="col-span-1 text-xs font-bold text-brand-text">₹{item.cost_price}</div>
                  <div className="col-span-1 text-xs font-medium text-brand-text/60">{item.selling_price > 0 ? `₹${item.selling_price}` : '-'}</div>
                  <div className="col-span-1 text-xs font-medium text-brand-text/60">{item.min_stock}</div>
                  <div className="col-span-2">
                    {item.quantity <= 0 ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-red-500/10 text-red-500 border border-red-500/20">
                        <AlertTriangle size={12} /> Out of Stock
                      </span>
                    ) : item.quantity <= item.min_stock ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                        <AlertTriangle size={12} /> Low Stock
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-green-500/10 text-green-500 border border-green-500/20">
                        <CheckCircle size={12} /> In Stock
                      </span>
                    )}
                  </div>
                  <div className="col-span-1 flex justify-end gap-2">
                    <button className="p-1.5 text-brand-text/50 hover:text-blue-500 hover:bg-blue-500/10 rounded-lg transition-colors" onClick={() => openEditModal(item)}>
                      <Edit2 size={16} />
                    </button>
                    <button className="p-1.5 text-brand-text/50 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors" onClick={() => setItemToDelete(item)}>
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
          <InventoryModal 
            item={editingItem} 
            onClose={() => setIsModalOpen(false)} 
            refresh={fetchInventory} 
          />
        )}
        
        {itemToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setItemToDelete(null)} />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-brand-card rounded-2xl shadow-2xl p-6 w-full max-w-sm flex flex-col items-center text-center z-10 border border-brand-glass-border/50"
            >
              <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                <Trash2 size={32} className="text-red-500" />
              </div>
              <h3 className="text-xl font-bold text-brand-text mb-2">Delete Item?</h3>
              <p className="text-sm text-brand-text/60 mb-6">Are you sure you want to delete <span className="font-bold text-brand-text">"{itemToDelete.name}"</span>? This action cannot be undone.</p>
              
              <div className="flex gap-3 w-full">
                <button 
                  onClick={() => setItemToDelete(null)}
                  className="flex-1 px-4 py-3 rounded-xl text-sm font-bold bg-brand-secondary/30 hover:bg-brand-secondary/50 text-brand-text transition-colors border border-brand-glass-border"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmDelete}
                  className="flex-1 px-4 py-3 rounded-xl text-sm font-bold bg-red-500 hover:bg-red-600 text-white transition-colors shadow-lg shadow-red-500/20"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InventoryModal({ item, onClose, refresh }) {
  const isEdit = !!item;
  const [formData, setFormData] = useState({
    name: item?.name || '',
    category: item?.category || 'Beverages',
    quantity: item?.quantity || '',
    unit: item?.unit || 'Unit',
    min_stock: item?.min_stock || '',
    cost_price: item?.cost_price || '',
    selling_price: item?.selling_price || '',
    supplier: item?.supplier || '',
    date_added: item?.date_added || format(new Date(), 'yyyy-MM-dd'),
    notes: item?.notes || ''
  });

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.name) return toast.error("Item Name is required");
    
    const payload = {
      ...formData,
      quantity: Number(formData.quantity) || 0,
      min_stock: Number(formData.min_stock) || 0,
      cost_price: Number(formData.cost_price) || 0,
      selling_price: Number(formData.selling_price) || 0,
    };

    if (isEdit) {
      const { error } = await supabase.from('inventory').update(payload).eq('id', item.id);
      if (error) {
        console.error("Update error:", error);
        return toast.error("Failed to update item: " + error.message);
      }
      toast.success("Item updated successfully");
    } else {
      const { error } = await supabase.from('inventory').insert(payload);
      if (error) {
        console.error("Insert error:", error);
        return toast.error("Failed to add item: " + error.message);
      }
      toast.success("Item added successfully");
      
      // Sync: Also add as an Inventory expense
      if (payload.cost_price > 0) {
        await supabase.from('expenses').insert({
          description: `Inventory: ${payload.name}`,
          amount: payload.cost_price * (payload.quantity || 1),
          category: 'Inventory',
          date: new Date(payload.date_added || new Date()).toISOString(),
          payment_method: 'Cash',
          vendor: payload.supplier || '',
          notes: `Auto-added from Inventory: ${payload.notes || ''}`
        });
      }
    }
    
    refresh();
    onClose();
  };

  return createPortal(
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
            <Package size={20} className="text-brand-primary" />
            {isEdit ? 'Edit Inventory Item' : 'Add Inventory Item'}
          </h2>
          <button className="text-brand-text/50 hover:text-brand-text hover:bg-brand-secondary/50 p-1.5 rounded-lg transition-colors" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Item Name *</label>
              <input type="text" name="name" placeholder="Item name" value={formData.name} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text" required />
            </div>
            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Category</label>
              <select name="category" value={formData.category} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text appearance-none">
                <option value="Beverages">Beverages</option>
                <option value="Food">Food</option>
                <option value="Packaging">Packaging</option>
                <option value="Cleaning">Cleaning</option>
                <option value="Equipment">Equipment</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Quantity *</label>
              <input type="number" step="0.01" name="quantity" placeholder="0" value={formData.quantity} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text" required />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Unit</label>
                <select name="unit" value={formData.unit} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text appearance-none">
                  <option>Unit</option>
                  <option>Litre</option>
                  <option>Packet</option>
                  <option>Kg</option>
                  <option>Gms</option>
                  <option>Box</option>
                  <option>ML</option>
                  <option>Can</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Min Stock</label>
                <input type="number" step="0.01" name="min_stock" placeholder="0" value={formData.min_stock} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Cost Price (₹)</label>
              <input type="number" step="0.01" name="cost_price" placeholder="0" value={formData.cost_price} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text" />
            </div>
            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Selling Price (₹)</label>
              <input type="number" step="0.01" name="selling_price" placeholder="0" value={formData.selling_price} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text" />
            </div>

            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Supplier</label>
              <input type="text" name="supplier" placeholder="Supplier name" value={formData.supplier} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text" />
            </div>
            <div>
              <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Date Added</label>
              <input type="date" name="date_added" value={formData.date_added} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text style-color-scheme-dark" />
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-xs font-bold text-brand-text/70 mb-1.5">Notes</label>
            <textarea name="notes" rows="3" value={formData.notes} onChange={handleChange} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text resize-none" />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-brand-glass-border">
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-bold text-brand-text/70 bg-brand-secondary/30 hover:bg-brand-secondary/50 rounded-xl transition-colors">
              Cancel
            </button>
            <button type="submit" className="px-5 py-2.5 text-sm font-bold text-white bg-brand-primary hover:bg-brand-accent rounded-xl shadow-lg shadow-brand-primary/20 transition-colors">
              Save Item
            </button>
          </div>
        </form>
      </motion.div>
    </div>,
    document.body
  );
}
