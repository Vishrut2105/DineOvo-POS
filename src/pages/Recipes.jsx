import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { ChefHat, Plus, Trash2, Search, X, FlaskConical, PackageOpen, CheckCircle2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

export default function Recipes() {
  const [menuItems, setMenuItems] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [recipes, setRecipes] = useState([]); // all recipe_items rows
  const [searchQuery, setSearchQuery] = useState('');
  const [editingMenuItem, setEditingMenuItem] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [{ data: menuData }, { data: invData }, { data: recipeData }] = await Promise.all([
      supabase.from('menu_items').select('*').order('name'),
      supabase.from('inventory').select('*').order('name'),
      supabase.from('recipe_items').select('*, inventory(name, unit)')
    ]);
    if (menuData) setMenuItems(menuData);
    if (invData) setInventory(invData);
    if (recipeData) setRecipes(recipeData);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();

    const sub = supabase
      .channel('recipes_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipe_items' }, fetchAll)
      .subscribe();

    return () => supabase.removeChannel(sub);
  }, [fetchAll]);

  // Group recipes by menu_item_id for easy lookup
  const recipesByMenuItemId = useMemo(() => {
    const map = {};
    recipes.forEach(r => {
      if (!map[r.menu_item_id]) map[r.menu_item_id] = [];
      map[r.menu_item_id].push(r);
    });
    return map;
  }, [recipes]);

  const filteredMenuItems = useMemo(() =>
    menuItems.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.category && item.category.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const itemRecipes = recipesByMenuItemId[item.id] || [];
      const matchesInventory = itemRecipes.some(r => r.inventory?.name?.toLowerCase().includes(searchQuery.toLowerCase()));

      return matchesSearch || matchesInventory;
    }),
    [menuItems, searchQuery, recipesByMenuItemId]
  );

  const totalWithRecipes = menuItems.filter(m => recipesByMenuItemId[m.id]?.length > 0).length;

  if (loading) {
    return <div className="flex items-center justify-center h-full text-brand-text/40 font-medium">Loading recipes...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-6">
        <div>
          <h2 className="text-3xl font-black text-brand-text mb-1 flex items-center gap-3">
            <ChefHat className="text-brand-primary" size={28} />
            Recipe Manager
          </h2>
          <p className="text-sm font-medium text-brand-text/50">
            Link menu items to their ingredients for automatic stock deduction
          </p>
        </div>

        {/* Progress Pill */}
        <div className="bg-brand-card border border-brand-glass-border rounded-xl px-5 py-3 text-center">
          <div className="text-2xl font-black text-brand-primary">{totalWithRecipes}<span className="text-brand-text/40 font-medium text-base">/{menuItems.length}</span></div>
          <div className="text-[10px] font-bold tracking-widest text-brand-text/50 uppercase mt-0.5">Items Configured</div>
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-brand-primary/5 border border-brand-primary/20 rounded-2xl p-4 mb-6 flex items-start gap-3">
        <FlaskConical size={18} className="text-brand-primary shrink-0 mt-0.5" />
        <p className="text-sm text-brand-text/70 font-medium">
          When an order is marked as <span className="font-bold text-brand-text">Done</span>, the system automatically deducts the ingredients listed in each item's recipe from your inventory. Items without a recipe are skipped.
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-primary" />
        <input
          type="text"
          placeholder="Search menu items..."
          className="w-full bg-brand-card border border-brand-glass-border rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-shadow"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Menu Item Cards Grid */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <AnimatePresence mode="popLayout">
          {filteredMenuItems.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center justify-center h-48 text-brand-text/40 font-medium"
            >
              <PackageOpen size={40} className="mb-3 opacity-30" />
              <p>No menu items found</p>
            </motion.div>
          ) : (
            <motion.div
              layout
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            >
              {filteredMenuItems.map((menuItem, i) => {
                const itemRecipes = recipesByMenuItemId[menuItem.id] || [];
                const hasRecipe = itemRecipes.length > 0;
                return (
                  <motion.div
                    layout
                    key={menuItem.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={`bg-brand-card border rounded-2xl p-5 flex flex-col gap-4 hover:shadow-md transition-all ${hasRecipe ? 'border-brand-primary/30' : 'border-brand-glass-border'}`}
                  >
                    {/* Item Header */}
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-brand-text truncate">{menuItem.name}</h3>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-brand-text/40">{menuItem.category || 'Uncategorized'}</span>
                      </div>
                      {hasRecipe ? (
                        <span className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/10 text-green-500 border border-green-500/20">
                          <CheckCircle2 size={10} /> Set
                        </span>
                      ) : (
                        <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-text/5 text-brand-text/40 border border-brand-glass-border">
                          No Recipe
                        </span>
                      )}
                    </div>

                    {/* Ingredient List Preview */}
                    <div className="flex-1 min-h-[48px]">
                      {hasRecipe ? (
                        <ul className="space-y-1.5">
                          {itemRecipes.slice(0, 3).map(r => (
                            <li key={r.id} className="flex justify-between items-center text-xs">
                              <span className="font-medium text-brand-text/70 truncate">{r.inventory?.name}</span>
                              <span className="font-bold text-brand-text shrink-0 ml-2">{r.quantity_used} {r.inventory?.unit}</span>
                            </li>
                          ))}
                          {itemRecipes.length > 3 && (
                            <li className="text-[10px] text-brand-text/40 font-medium">+{itemRecipes.length - 3} more ingredients</li>
                          )}
                        </ul>
                      ) : (
                        <p className="text-xs text-brand-text/30 font-medium italic">No ingredients linked yet</p>
                      )}
                    </div>

                    {/* Action Button */}
                    <button
                      onClick={() => setEditingMenuItem({ menuItem, currentRecipes: itemRecipes })}
                      className={`w-full py-2.5 rounded-xl text-xs font-bold transition-colors border flex items-center justify-center gap-1.5 ${
                        hasRecipe
                          ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/20 hover:bg-brand-primary/20'
                          : 'bg-brand-bg text-brand-text/60 border-brand-glass-border hover:bg-brand-primary/10 hover:text-brand-primary hover:border-brand-primary/20'
                      }`}
                    >
                      <Plus size={13} />
                      {hasRecipe ? 'Edit Recipe' : 'Set Recipe'}
                    </button>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Recipe Edit Modal */}
      <AnimatePresence>
        {editingMenuItem && (
          <RecipeModal
            menuItem={editingMenuItem.menuItem}
            currentRecipes={editingMenuItem.currentRecipes}
            inventory={inventory}
            onClose={() => setEditingMenuItem(null)}
            onSaved={fetchAll}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function RecipeModal({ menuItem, currentRecipes, inventory, onClose, onSaved }) {
  // Local state — start with the existing recipe rows
  const [lines, setLines] = useState(
    currentRecipes.length > 0
      ? currentRecipes.map(r => ({ id: r.id, inventory_item_id: r.inventory_item_id, quantity_used: r.quantity_used }))
      : [{ id: null, inventory_item_id: '', quantity_used: '' }]
  );
  const [saving, setSaving] = useState(false);

  const addLine = () => setLines(prev => [...prev, { id: null, inventory_item_id: '', quantity_used: '' }]);

  const removeLine = (index) => setLines(prev => prev.filter((_, i) => i !== index));

  const updateLine = (index, field, value) => {
    setLines(prev => prev.map((line, i) => i === index ? { ...line, [field]: value } : line));
  };

  const handleSave = async () => {
    // Validate — every line must have an inventory item and qty > 0
    for (const line of lines) {
      if (!line.inventory_item_id) return toast.error('Please select an ingredient for every row');
      if (!line.quantity_used || Number(line.quantity_used) <= 0) return toast.error('Quantity must be greater than 0');
    }

    // Check for duplicates
    const ids = lines.map(l => l.inventory_item_id);
    if (new Set(ids).size !== ids.length) return toast.error('Duplicate ingredients found — each ingredient can only appear once');

    setSaving(true);
    try {
      // Delete all existing recipe_items for this menu item, then re-insert
      const { error: delError } = await supabase
        .from('recipe_items')
        .delete()
        .eq('menu_item_id', menuItem.id);

      if (delError) throw delError;

      if (lines.length > 0) {
        const inserts = lines.map(line => ({
          menu_item_id: menuItem.id,
          inventory_item_id: line.inventory_item_id,
          quantity_used: Number(line.quantity_used)
        }));

        const { error: insError } = await supabase.from('recipe_items').insert(inserts);
        if (insError) throw insError;
      }

      toast.success(`Recipe saved for "${menuItem.name}"`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error('Failed to save recipe: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClearRecipe = async () => {
    if (!window.confirm(`Clear the entire recipe for "${menuItem.name}"?`)) return;
    await supabase.from('recipe_items').delete().eq('menu_item_id', menuItem.id);
    toast.success('Recipe cleared');
    onSaved();
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-brand-card rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden z-10 relative border border-brand-glass-border/50 max-h-[90vh]"
      >
        {/* Modal Header */}
        <div className="flex justify-between items-center p-5 border-b border-brand-glass-border bg-brand-bg/50 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-brand-text flex items-center gap-2">
              <ChefHat size={18} className="text-brand-primary" />
              Recipe for: <span className="text-brand-primary">{menuItem.name}</span>
            </h2>
            <p className="text-xs text-brand-text/50 mt-0.5">Define ingredients consumed per 1 serving</p>
          </div>
          <button className="text-brand-text/50 hover:text-brand-text hover:bg-brand-secondary/50 p-1.5 rounded-lg transition-colors" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-12 gap-3 px-5 py-2.5 bg-brand-bg/30 border-b border-brand-glass-border/50 shrink-0">
          <div className="col-span-7 text-[10px] font-black text-brand-text/40 tracking-widest uppercase">Ingredient</div>
          <div className="col-span-3 text-[10px] font-black text-brand-text/40 tracking-widest uppercase">Qty Used</div>
          <div className="col-span-2"></div>
        </div>

        {/* Ingredient Lines */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-3 no-scrollbar">
          <AnimatePresence>
            {lines.map((line, index) => {
              const selectedInvItem = inventory.find(i => i.id === line.inventory_item_id);
              return (
                <motion.div
                  key={index}
                  layout
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  className="grid grid-cols-12 gap-3 items-center"
                >
                  <div className="col-span-7">
                    <select
                      value={line.inventory_item_id}
                      onChange={e => updateLine(index, 'inventory_item_id', e.target.value)}
                      className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text appearance-none"
                    >
                      <option value="">Select ingredient...</option>
                      {inventory.map(inv => (
                        <option key={inv.id} value={inv.id}>
                          {inv.name} ({inv.unit})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3 flex items-center gap-1.5">
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      placeholder="0"
                      value={line.quantity_used}
                      onChange={e => updateLine(index, 'quantity_used', e.target.value)}
                      className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-primary/50 text-brand-text"
                    />
                    {selectedInvItem && (
                      <span className="text-[10px] text-brand-text/40 font-bold shrink-0">{selectedInvItem.unit}</span>
                    )}
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <button
                      onClick={() => removeLine(index)}
                      className="p-1.5 text-brand-text/40 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          <button
            onClick={addLine}
            className="w-full py-2.5 rounded-xl border border-dashed border-brand-glass-border text-brand-text/50 text-xs font-bold hover:border-brand-primary/40 hover:text-brand-primary hover:bg-brand-primary/5 transition-all flex items-center justify-center gap-1.5 mt-1"
          >
            <Plus size={14} /> Add Ingredient
          </button>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center gap-3 p-5 border-t border-brand-glass-border shrink-0">
          <button
            onClick={handleClearRecipe}
            className="px-4 py-2.5 text-xs font-bold text-red-500/70 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-colors border border-transparent hover:border-red-500/20"
          >
            Clear Recipe
          </button>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-bold text-brand-text/70 bg-brand-secondary/30 hover:bg-brand-secondary/50 rounded-xl transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2.5 text-sm font-bold text-white bg-brand-primary hover:bg-brand-accent rounded-xl shadow-lg shadow-brand-primary/20 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Recipe'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
