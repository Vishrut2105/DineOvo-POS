import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Check, X, Star, Edit, Trash2, Search, X as XIcon, ThumbsUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import CategorySelect from '../components/CategorySelect';

export default function MenuEditor({ menuItems, fetchMenuItems }) {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [isSetSpecialOpen, setIsSetSpecialOpen] = useState(false);
  const [deletingItem, setDeletingItem] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  const categories = useMemo(() => {
    const cats = new Set(menuItems.map(item => item.category).filter(Boolean));
    return ['All', ...Array.from(cats)];
  }, [menuItems]);

  const filteredItems = useMemo(() => {
    return menuItems.filter(item => {
      const safeName = item.name || '';
      const safeDesc = item.description || '';
      const safeCat = item.category || '';
      
      const matchesSearch = safeName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            safeDesc.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            safeCat.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = activeCategory === 'All' || item.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [menuItems, searchQuery, activeCategory]);

  const todaysSpecials = menuItems.filter(item => item.is_todays_special);

  const clearTodaysSpecial = async () => {
    if (todaysSpecials.length === 0) return;
    for (const s of todaysSpecials) {
        await supabase.from('menu_items').update({ is_todays_special: false, is_special: false }).eq('id', s.id);
    }
    fetchMenuItems();
  };

  const confirmDelete = async () => {
    if (!deletingItem) return;
    await supabase.from('menu_items').delete().eq('id', deletingItem.id);
    setDeletingItem(null);
    fetchMenuItems();
  };

  return (
    <div className="flex flex-col h-full bg-brand-bg relative w-full overflow-y-auto overflow-x-hidden">
      <div className="p-6 max-w-350 mx-auto w-full flex-1">
         {/* Today's Special Banner */}
         <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-brand-warning/10 border border-brand-warning/20 rounded-[20px] p-6 flex flex-col md:flex-row justify-between items-center gap-4 mb-10 shadow-sm relative overflow-hidden"
         >
             <div className="absolute top-0 right-0 w-64 h-64 bg-brand-warning/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none"></div>
             <div className="relative z-10 w-full md:w-auto text-center md:text-left">
                 <div className="flex items-center justify-center md:justify-start gap-2 text-brand-warning text-xs font-black tracking-widest uppercase mb-2">
                     <Star size={14} fill="currentColor" /> TODAY'S SPECIAL
                 </div>
                 {todaysSpecials.length > 0 ? (
                    <div>
                        <div className="text-xl font-bold text-brand-text mb-1">{todaysSpecials.length} {todaysSpecials.length === 1 ? 'Item' : 'Items'} marked as Special</div>
                        <div className="flex flex-wrap gap-2 mt-3 items-center justify-center md:justify-start">
                            {todaysSpecials.map(item => (
                                <div key={item.id} className="bg-brand-bg/80 border border-brand-warning/30 rounded-lg py-1.5 px-3 flex items-center gap-2 shadow-sm">
                                    <span className="text-sm font-bold text-brand-text">{item.name}</span>
                                    <div className="flex items-center gap-1 border-l border-brand-warning/20 pl-2 ml-1">
                                        <button 
                                            onClick={() => setEditingItem(item)} 
                                            className="text-brand-text/50 hover:text-brand-primary transition-colors p-1"
                                            title="Edit Item"
                                        >
                                            <Edit size={12} />
                                        </button>
                                        <button 
                                            onClick={async () => {
                                                await supabase.from('menu_items').update({ is_todays_special: false, is_special: false }).eq('id', item.id);
                                                fetchMenuItems();
                                            }} 
                                            className="text-brand-text/50 hover:text-brand-danger transition-colors p-1"
                                            title="Remove from Specials"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                 ) : (
                    <div className="text-xl font-bold text-brand-text/50">
                        No special set for today
                    </div>
                 )}
             </div>
             <div className="relative z-10 flex flex-col sm:flex-row gap-3 w-full md:w-auto justify-center sm:items-center mt-4 md:mt-0">
                 <button 
                    className="bg-brand-warning/10 hover:bg-brand-warning/20 border border-brand-warning/30 text-brand-warning font-bold py-2.5 px-6 rounded-full flex items-center gap-2 transition-colors whitespace-nowrap shadow-sm flex-1 md:flex-none justify-center" 
                    onClick={() => setIsSetSpecialOpen(true)}
                 >
                     <Star size={16} fill="currentColor" /> {todaysSpecials.length > 0 ? 'Manage Specials' : 'Set Special'}
                 </button>
                 {todaysSpecials.length > 0 && (
                    <button 
                        className="bg-brand-card hover:bg-brand-secondary/50 border border-brand-glass-border text-brand-text/70 hover:text-brand-text font-bold py-2.5 px-4 rounded-full flex items-center gap-2 transition-colors whitespace-nowrap shadow-sm" 
                        onClick={clearTodaysSpecial}
                    >
                        <XIcon size={16} /> Clear All
                    </button>
                 )}
             </div>
         </motion.div>

         {/* Header Row */}
         <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6"
         >
             <div className="flex items-center gap-4">
                 <h2 className="text-2xl font-bold m-0 text-brand-text">Menu Items</h2>
                 <span className="bg-brand-primary/10 text-brand-primary text-xs font-bold px-3 py-1 rounded-full">{menuItems.length} items</span>
             </div>
             <button className="bg-brand-primary hover:bg-brand-primary/90 text-white font-medium py-2.5 px-6 rounded-full flex items-center gap-2 shadow-lg shadow-brand-primary/20 transition-all w-full md:w-auto justify-center" onClick={() => setIsAddOpen(true)}>
                 <Plus size={16} /> Add Item
             </button>
         </motion.div>

         {/* Search Bar */}
         <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="relative mb-6 shadow-sm rounded-xl"
         >
             <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-text/40" />
             <input 
                 type="text" 
                 placeholder="Search items by name, category or description..." 
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 className="w-full bg-brand-card border border-brand-glass-border rounded-xl pl-12 pr-4 py-3.5 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 transition-all text-brand-text placeholder-brand-text/40 font-medium"
             />
         </motion.div>

         {/* Category Pills */}
         <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-2 overflow-x-auto pb-4 mb-2 no-scrollbar"
         >
             {categories.map(cat => (
                 <button 
                     key={cat}
                     onClick={() => setActiveCategory(cat)}
                     className={`px-5 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all border ${
                         activeCategory === cat 
                         ? 'bg-brand-primary border-brand-primary text-white shadow-md' 
                         : 'bg-brand-card border-brand-glass-border text-brand-text/70 hover:bg-brand-secondary/50 hover:text-brand-text'
                     }`}
                 >
                     {cat}
                 </button>
             ))}
         </motion.div>

         {/* Grid Layout */}
         <AnimatePresence mode="wait">
             <motion.div 
                 key={activeCategory + searchQuery}
                 initial={{ opacity: 0, y: 10 }}
                 animate={{ opacity: 1, y: 0 }}
                 exit={{ opacity: 0, y: -10 }}
                 transition={{ duration: 0.15 }}
                 className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
             >
                 {filteredItems.map(item => (
                     <MenuItemCard 
                        key={item.id} 
                        item={item} 
                        onEdit={() => setEditingItem(item)} 
                        onDelete={() => setDeletingItem(item)} 
                     />
                 ))}
             </motion.div>
         </AnimatePresence>

         {filteredItems.length === 0 && (
            <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               className="text-center py-24 bg-brand-card border border-brand-glass-border rounded-3xl mt-6 shadow-sm"
            >
                <Search size={48} className="mx-auto text-brand-text/20 mb-4" />
                <h3 className="text-xl font-bold mb-2 text-brand-text">No items found</h3>
                <p className="text-brand-text/50">Try adjusting your search or category filters.</p>
            </motion.div>
         )}
      </div>

      {/* Modals */}
      <AnimatePresence>
          {(isAddOpen || editingItem) && (
            <MenuFormModal 
              item={editingItem} 
              menuItems={menuItems}
              onClose={() => { setIsAddOpen(false); setEditingItem(null); }} 
              onSave={fetchMenuItems} 
            />
          )}

          {isSetSpecialOpen && (
              <SetSpecialModal 
                 menuItems={menuItems}
                 onClose={() => setIsSetSpecialOpen(false)}
                 onSave={fetchMenuItems}
                 onNewSpecial={() => { setIsSetSpecialOpen(false); setIsAddOpen(true); }}
              />
          )}

          {deletingItem && (
              <DeleteConfirmModal 
                  itemName={deletingItem.name} 
                  onCancel={() => setDeletingItem(null)} 
                  onConfirm={confirmDelete} 
              />
          )}
      </AnimatePresence>
    </div>
  );
}

function MenuItemCard({ item, onEdit, onDelete }) {
    // Optimistic state for availability
    const [isAvailable, setIsAvailable] = useState(item.is_available);
    
    // Sync state if item changes externally
    useEffect(() => {
        setIsAvailable(item.is_available);
    }, [item.is_available]);

    const handleToggleAvailable = async () => {
        const newValue = !isAvailable;
        setIsAvailable(newValue); // optimistic update
        const { error } = await supabase.from('menu_items').update({ is_available: newValue }).eq('id', item.id);
        if (error) {
            setIsAvailable(!newValue); // revert on error
        }
    };

    const toggleMustTry = async () => {
        await supabase.from('menu_items').update({ is_special: !item.is_special }).eq('id', item.id);
    };

    return (
        <div 
            className={`bg-brand-card border rounded-[20px] p-6 flex flex-col transition-all shadow-sm group relative overflow-hidden ${item.is_todays_special ? 'border-brand-warning shadow-brand-warning/10 shadow-lg' : 'border-brand-glass-border hover:border-brand-primary/50 hover:shadow-md'}`}
        >
            {item.is_todays_special && (
                <div className="absolute top-0 right-0 bg-brand-warning text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-bl-xl shadow-sm z-10 flex items-center gap-1">
                    <Star size={10} fill="currentColor" /> Special
                </div>
            )}
            <div className="flex justify-between items-start mb-2 gap-4">
                <h3 className="font-bold text-lg text-brand-text m-0 leading-tight group-hover:text-brand-primary transition-colors pr-12">{item.name}</h3>
                <span className="font-bold text-brand-primary text-xl whitespace-nowrap tracking-tight">₹{item.price}</span>
            </div>
            <div className="mb-3">
                <span className="inline-block bg-brand-primary/10 text-brand-primary text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider">
                    {item.category || 'UNCATEGORIZED'}
                </span>
            </div>
            <p className="text-sm text-brand-text/60 line-clamp-3 mb-6 flex-1 min-h-10 leading-relaxed">
                {item.description || 'No description available for this item.'}
            </p>
            
            {/* Toggle Availability (Optimistic) */}
            <div className="flex items-center gap-3 mb-6">
                <button 
                    onClick={handleToggleAvailable}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${isAvailable ? 'bg-brand-success' : 'bg-brand-text/20'}`}
                >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isAvailable ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className={`text-sm font-bold ${isAvailable ? 'text-brand-text' : 'text-brand-text/50'}`}>
                    {isAvailable ? 'Available' : 'Unavailable'}
                </span>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-5 border-t border-brand-glass-border">
                <button 
                    onClick={onEdit} 
                    className="flex-1 bg-brand-card border border-brand-glass-border hover:bg-brand-primary/10 hover:text-brand-primary hover:border-brand-primary/30 text-brand-text/80 text-xs font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                >
                    <Edit size={14} /> Edit
                </button>
                <button 
                    onClick={toggleMustTry} 
                    className={`flex-[1.5] border text-xs font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition-colors ${item.is_special ? 'border-brand-warning/30 bg-brand-warning/10 text-brand-warning' : 'bg-brand-card border-brand-glass-border text-brand-text/80 hover:bg-brand-warning/10 hover:text-brand-warning hover:border-brand-warning/30'}`}
                >
                    <ThumbsUp size={14} fill={item.is_special ? "currentColor" : "none"} /> Must Try
                </button>
                <button 
                    onClick={onDelete} 
                    className="w-10 h-10 shrink-0 rounded-lg bg-brand-card border border-brand-glass-border text-brand-text/50 hover:bg-brand-danger/10 hover:text-brand-danger hover:border-brand-danger/30 flex items-center justify-center transition-colors"
                >
                    <Trash2 size={16} />
                </button>
            </div>
        </div>
    );
}

function MenuFormModal({ item, menuItems, onClose, onSave }) {
  const [name, setName] = useState(item?.name || '');
  const [price, setPrice] = useState(item?.price || '');
  const [category, setCategory] = useState(item?.category || '');
  const [description, setDescription] = useState(item?.description || '');
  const [isTodaysSpecial, setIsTodaysSpecial] = useState(item?.is_todays_special || false);

  const existingCategories = useMemo(
    () => Array.from(new Set(menuItems.map(i => i.category).filter(Boolean))).sort(),
    [menuItems]
  );

  const handleSave = async () => {
    if (!name || !price) return;
    


    if (item) {
      await supabase.from('menu_items').update({ 
          name, 
          price: parseFloat(price), 
          category,
          description,
          is_todays_special: isTodaysSpecial,
          is_special: isTodaysSpecial
      }).eq('id', item.id);
    } else {
      await supabase.from('menu_items').insert({ 
          name, 
          price: parseFloat(price), 
          category, 
          description,
          is_available: true, 
          is_special: isTodaysSpecial, 
          is_todays_special: isTodaysSpecial 
      });
    }
    onSave();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-brand-bg/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto py-10" onClick={onClose}>
      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 15 }}
        transition={{ duration: 0.2 }}
        className="bg-brand-bg border border-brand-glass-border w-full max-w-lg rounded-3xl shadow-2xl flex flex-col" 
        onClick={e => e.stopPropagation()}
      >
        <div className="p-8 pb-6 flex flex-col gap-6">
            <div>
                <h2 className="text-2xl font-bold text-brand-text mb-2 tracking-tight">{item ? 'Edit Item' : 'Add New Item'}</h2>
                <p className="text-sm text-brand-text/60">Fill in the details to {item ? 'edit this' : 'add a new'} menu item.</p>
            </div>

            <div className="flex flex-col gap-5">
                <div>
                    <label className="block text-xs font-black tracking-widest text-brand-text/70 uppercase mb-2.5">Item Name *</label>
                    <input 
                        type="text" 
                        placeholder="e.g. Funghi Cremosi" 
                        className="w-full bg-brand-card border border-brand-glass-border rounded-xl px-4 py-3 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 text-brand-text font-medium transition-all shadow-sm" 
                        value={name} 
                        onChange={e => setName(e.target.value)} 
                    />
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-black tracking-widest text-brand-text/70 uppercase mb-2.5">Price (₹) *</label>
                        <input 
                            type="number" 
                            placeholder="0" 
                            className="w-full bg-brand-card border border-brand-glass-border rounded-xl px-4 py-3 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 text-brand-text font-medium transition-all shadow-sm" 
                            value={price} 
                            onChange={e => setPrice(e.target.value)} 
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-black tracking-widest text-brand-text/70 uppercase mb-2.5">Category *</label>
                        <CategorySelect categories={existingCategories} value={category} onChange={setCategory} required />
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-black tracking-widest text-brand-text/70 uppercase mb-2.5">Description (Optional)</label>
                    <textarea 
                        placeholder="Short description of the item" 
                        rows="3"
                        className="w-full bg-brand-card border border-brand-glass-border rounded-xl px-4 py-3 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 text-brand-text resize-none font-medium transition-all shadow-sm" 
                        value={description} 
                        onChange={e => setDescription(e.target.value)} 
                    ></textarea>
                </div>

                <div className="bg-brand-warning/5 border border-brand-warning/20 rounded-xl p-5 flex items-center justify-between">
                    <div className="flex gap-4">
                        <Star className="text-brand-warning shrink-0 mt-0.5" fill="currentColor" size={20} />
                        <div>
                            <div className="text-sm font-bold text-brand-text mb-0.5">Mark as Today's Special</div>
                            <div className="text-xs text-brand-text/60">Highlights this item across all menus</div>
                        </div>
                    </div>
                    <button 
                        onClick={() => setIsTodaysSpecial(!isTodaysSpecial)}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${isTodaysSpecial ? 'bg-brand-warning' : 'bg-brand-text/20'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${isTodaysSpecial ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>
            </div>
        </div>

        <div className="p-8 pt-4 flex gap-4 mt-auto border-t border-brand-glass-border/50 bg-brand-card/50">
            <button className="flex-1 bg-brand-card border border-brand-glass-border hover:bg-brand-secondary/50 text-brand-text font-bold py-3.5 rounded-xl transition-colors shadow-sm" onClick={onClose}>Cancel</button>
            <button className="flex-2 bg-[#3B82F6] hover:bg-[#2563EB] text-white font-bold py-3.5 rounded-xl shadow-lg shadow-blue-500/20 transition-colors" onClick={handleSave}>{item ? 'Save Changes' : 'Add Item'}</button>
        </div>
      </motion.div>
    </div>
  );
}

function SetSpecialModal({ menuItems, onClose, onSave, onNewSpecial }) {
    const [search, setSearch] = useState('');
    
    const filteredItems = menuItems.filter(item => {
        const safeName = item.name || '';
        const safeCat = item.category || '';
        return safeName.toLowerCase().includes(search.toLowerCase()) || 
               safeCat.toLowerCase().includes(search.toLowerCase());
    });

    const handleSetSpecial = async (item) => {
        const newValue = !item.is_todays_special;
        await supabase.from('menu_items').update({ is_todays_special: newValue, is_special: newValue }).eq('id', item.id);
        onSave();
    };

    return (
        <div className="fixed inset-0 z-50 bg-brand-bg/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
            transition={{ duration: 0.2 }}
            className="bg-brand-bg border border-brand-glass-border w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]" 
            onClick={e => e.stopPropagation()}
          >
            <div className="p-8 pb-6 border-b border-brand-glass-border shrink-0 bg-brand-card/30">
                <h2 className="text-2xl font-bold text-brand-text mb-2 tracking-tight">Set Today's Special</h2>
                <p className="text-sm text-brand-text/60 mb-6">Pick an existing item to feature, or add a new one.</p>
                
                <div className="relative shadow-sm rounded-xl">
                     <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-text/40" />
                     <input 
                         type="text" 
                         placeholder="Search items..." 
                         value={search}
                         onChange={(e) => setSearch(e.target.value)}
                         className="w-full bg-brand-card border border-brand-glass-border rounded-xl pl-12 pr-4 py-3.5 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 text-brand-text font-medium transition-all"
                     />
                 </div>
            </div>
            
            <div className="overflow-y-auto p-6 flex flex-col gap-3 bg-brand-bg">
                {filteredItems.map(item => {
                    const isSelected = item.is_todays_special;
                    return (
                        <button 
                            key={item.id} 
                            onClick={() => handleSetSpecial(item)}
                            className={`flex justify-between items-center p-4 rounded-2xl text-left transition-all shadow-sm group border ${
                                isSelected 
                                ? 'bg-brand-warning/10 border-brand-warning shadow-brand-warning/20 relative overflow-hidden' 
                                : 'bg-brand-card border-brand-glass-border hover:bg-brand-primary/5 hover:border-brand-primary/40'
                            }`}
                        >
                            {isSelected && (
                                <div className="absolute top-0 right-0 w-16 h-16 bg-brand-warning/20 rounded-bl-full pointer-events-none flex items-start justify-end p-2">
                                    <Check size={16} className="text-brand-warning" />
                                </div>
                            )}
                            <div className="relative z-10">
                                <div className={`font-bold mb-1.5 text-base transition-colors ${isSelected ? 'text-brand-warning' : 'text-brand-text group-hover:text-brand-primary'}`}>{item.name}</div>
                                <div className={`text-[10px] font-black uppercase tracking-widest ${isSelected ? 'text-brand-warning/70' : 'text-brand-text/50'}`}>{item.category || 'Uncategorized'}</div>
                            </div>
                            <div className={`font-bold text-lg flex items-center gap-4 relative z-10 ${isSelected ? 'text-brand-warning' : 'text-brand-primary'}`}>
                                 ₹{item.price}
                                 <div className={`w-1.5 h-8 rounded-full transition-colors ${isSelected ? 'bg-brand-warning/50' : 'bg-brand-glass-border group-hover:bg-brand-primary/30'}`}></div>
                            </div>
                        </button>
                    )
                })}
                {filteredItems.length === 0 && (
                    <div className="text-center py-12 text-brand-text/50">
                        <Search size={32} className="mx-auto mb-3 opacity-20" />
                        <div className="font-medium">No items match your search.</div>
                    </div>
                )}
            </div>

            <div className="p-8 pt-4 flex gap-4 border-t border-brand-glass-border/50 shrink-0 bg-brand-card/50">
                <button className="flex-1 bg-brand-card border border-brand-glass-border hover:bg-brand-secondary/50 text-brand-text font-bold py-3.5 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2" onClick={onNewSpecial}>
                    <Plus size={18} /> New Item
                </button>
                <button className="flex-2 bg-brand-warning hover:bg-brand-warning/90 text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center shadow-sm" onClick={onClose}>
                    Done
                </button>
            </div>
          </motion.div>
        </div>
    );
}

function DeleteConfirmModal({ itemName, onCancel, onConfirm }) {
    return (
        <div className="fixed inset-0 z-50 bg-brand-bg/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
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
                  <h3 className="text-xl font-bold text-brand-text mb-2">Delete Item?</h3>
                  <p className="text-sm text-brand-text/60">
                      Are you sure you want to delete <span className="font-bold text-brand-text">"{itemName}"</span>? This action cannot be undone.
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
