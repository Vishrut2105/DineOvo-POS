import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Save, Users, Square, Circle, RectangleHorizontal, X } from 'lucide-react';
import toast from 'react-hot-toast';

export default function FloorPlanBuilder({ tables = [], refreshTables }) {
  const [localTables, setLocalTables] = useState([]);
  const [saving, setSaving] = useState(false);
  const [tableToDelete, setTableToDelete] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    // A property edit (shape/name/seats) triggers refreshTables(), which used to blow away
    // any table dragged-but-not-yet-saved via "Save Layout" — merge instead of overwrite,
    // keeping locally-dragged x/y and taking everything else fresh from the server.
    setLocalTables(prevLocal => {
      const localById = new Map(prevLocal.map(t => [t.id, t]));
      return tables.map(serverTable => {
        const local = localById.get(serverTable.id);
        return local ? { ...serverTable, x: local.x, y: local.y } : serverTable;
      });
    });
  }, [tables]);

  const addTable = async () => {
    // Derive from the highest existing table number, not array length — otherwise deleting
    // a middle table (e.g. T2 out of T1/T2/T3) and adding a new one collides with T3.
    const usedNumbers = localTables
      .map(t => parseInt(String(t.table_no).replace(/\D/g, ''), 10))
      .filter(n => !isNaN(n));
    const nextNumber = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1;

    const newTable = {
      table_no: `T${nextNumber}`,
      shape: 'square',
      seats: 4,
      x: 5,
      y: 5,
    };
    
    const { data, error } = await supabase.from('tables').insert(newTable).select().single();
    if (error) {
      toast.error('Failed to add table');
    } else {
      toast.success('Table added');
      refreshTables();
    }
  };

  const confirmRemoveTable = async () => {
    if (!tableToDelete) return;
    const { error } = await supabase.from('tables').delete().eq('id', tableToDelete.id);
    if (error) {
      toast.error('Failed to remove table');
    } else {
      toast.success('Table removed');
      refreshTables();
    }
    setTableToDelete(null);
  };

  const updateTableProperty = async (id, field, value) => {
    setLocalTables(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
    const { error } = await supabase.from('tables').update({ [field]: value }).eq('id', id);
    if (error) {
      toast.error('Failed to update table');
      refreshTables();
    } else {
      refreshTables();
    }
  };

  const handleDragEnd = (e, info, tableId) => {
    const parent = containerRef.current;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    
    const el = document.getElementById(`table-${tableId}`);
    if (!el) return;
    const elRect = el.getBoundingClientRect();
    
    let newX = ((elRect.left - parentRect.left) / parentRect.width) * 100;
    let newY = ((elRect.top - parentRect.top) / parentRect.height) * 100;

    // Constrain inside bounds
    newX = Math.max(0, Math.min(newX, 90));
    newY = Math.max(0, Math.min(newY, 90));
    
    setLocalTables(prev => prev.map(t => t.id === tableId ? { ...t, x: newX, y: newY } : t));
  };

  const saveLayout = async () => {
    setSaving(true);
    let successCount = 0;
    for (const table of localTables) {
       const { error } = await supabase.from('tables').update({ x: table.x, y: table.y }).eq('id', table.id);
       if (!error) successCount++;
    }
    if (successCount === localTables.length) {
      toast.success('Layout saved successfully!');
    } else {
      toast.error('Some tables failed to save. Try again.');
    }
    refreshTables();
    setSaving(false);
  };

  const getShapeClasses = (shape) => {
    switch(shape) {
      case 'circle': return 'rounded-full aspect-square w-24';
      case 'rectangle': return 'rounded-xl w-32 h-20';
      case 'square': default: return 'rounded-xl aspect-square w-24';
    }
  };

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex justify-between items-center bg-brand-bg/50 p-4 rounded-xl border border-brand-glass-border">
        <div>
          <h3 className="font-bold text-brand-text">Floor Plan Designer</h3>
          <p className="text-xs text-brand-text/50">Drag tables to arrange your layout</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={addTable}
            className="flex items-center gap-2 px-4 py-2 bg-brand-secondary/30 hover:bg-brand-secondary/50 text-brand-text text-sm font-bold rounded-xl transition-colors"
          >
            <Plus size={16} /> Add Table
          </button>
          <button 
            onClick={saveLayout}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-brand-primary hover:bg-brand-accent text-white text-sm font-bold rounded-xl shadow-lg shadow-brand-primary/20 transition-colors disabled:opacity-50"
          >
            <Save size={16} /> {saving ? 'Saving...' : 'Save Layout'}
          </button>
        </div>
      </div>

      <div 
        ref={containerRef}
        className="flex-1 min-h-[600px] bg-brand-bg rounded-2xl border border-brand-glass-border relative overflow-hidden"
        style={{ backgroundImage: 'radial-gradient(var(--glass-border) 1px, transparent 1px)', backgroundSize: '20px 20px' }}
      >
        {localTables.map(table => (
          <motion.div
            id={`table-${table.id}`}
            key={table.id}
            drag
            dragMomentum={false}
            dragElastic={0}
            dragConstraints={containerRef}
            onDragEnd={(e, info) => handleDragEnd(e, info, table.id)}
            initial={{ left: `${table.x}%`, top: `${table.y}%` }}
            style={{ position: 'absolute' }}
            whileDrag={{ scale: 1.05, zIndex: 50, cursor: 'grabbing' }}
            className={`flex flex-col items-center justify-center bg-brand-card border-2 border-brand-primary/50 shadow-lg cursor-grab group ${getShapeClasses(table.shape)}`}
          >
            {/* Quick Actions (Show on hover) */}
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex bg-brand-card border border-brand-glass-border rounded-lg shadow-xl overflow-hidden z-50">
              <button onClick={(e) => { e.stopPropagation(); setTableToDelete(table); }} className="p-1.5 text-red-500 hover:bg-red-500/10"><Trash2 size={14}/></button>
              <select 
                className="bg-transparent text-xs font-bold text-brand-text px-1 outline-none cursor-pointer"
                value={table.shape}
                onChange={(e) => updateTableProperty(table.id, 'shape', e.target.value)}
                onClick={e => e.stopPropagation()}
              >
                <option value="square">Square</option>
                <option value="circle">Circle</option>
                <option value="rectangle">Rectangle</option>
              </select>
            </div>

            <input 
              type="text" 
              value={table.table_no} 
              onChange={(e) => updateTableProperty(table.id, 'table_no', e.target.value)}
              onClick={e => e.stopPropagation()}
              className="bg-transparent text-center font-black text-brand-text w-full outline-none focus:bg-brand-bg/50 rounded-md"
            />
            
            <div className="flex items-center gap-1 text-xs font-bold text-brand-text/50 mt-1">
              <Users size={12} />
              <input 
                type="number" 
                value={table.seats} 
                onChange={(e) => updateTableProperty(table.id, 'seats', e.target.value)}
                onClick={e => e.stopPropagation()}
                className="bg-transparent text-center w-8 outline-none focus:bg-brand-bg/50 rounded-md"
              />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Delete Confirmation Modal */}
      {createPortal(
        <AnimatePresence>
          {tableToDelete && (
            <div className="fixed inset-0 z-[110] bg-brand-bg/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setTableToDelete(null)}>
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
                      <h3 className="text-xl font-bold text-brand-text mb-2">Remove Table?</h3>
                      <p className="text-sm text-brand-text/60">
                          Are you sure you want to remove table {tableToDelete.table_no}? This action cannot be undone.
                      </p>
                  </div>
                  <div className="p-6 pt-0 flex gap-3">
                      <button className="flex-1 bg-brand-bg hover:bg-brand-secondary/50 border border-brand-glass-border text-brand-text font-bold py-3 rounded-xl transition-colors" onClick={() => setTableToDelete(null)}>Cancel</button>
                      <button className="flex-1 bg-brand-danger hover:bg-red-600 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-brand-danger/30" onClick={confirmRemoveTable}>Remove</button>
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
