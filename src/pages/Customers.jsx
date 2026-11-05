import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Search, Star, Award, TrendingUp, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchCustomers = useCallback(async () => {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('points', { ascending: false });
    if (!error) setCustomers(data || []);
  }, []);

  useEffect(() => {
    fetchCustomers();
    let debounceTimer = null;
    const debouncedFetch = () => {
      if (document.hidden) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fetchCustomers, 3000);
    };

    const sub = supabase
      .channel('customers_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, debouncedFetch)
      .subscribe();

    return () => {
      clearTimeout(debounceTimer);
      supabase.removeChannel(sub);
    };
  }, [fetchCustomers]);

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const q = searchQuery.toLowerCase();
      return (c.name && c.name.toLowerCase().includes(q)) || (c.phone && c.phone.includes(q));
    });
  }, [customers, searchQuery]);

  const getTier = (spent) => {
    if (spent >= 10000) return { name: 'Gold', color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20' };
    if (spent >= 5000) return { name: 'Silver', color: 'text-slate-400 bg-slate-400/10 border-slate-400/20' };
    return { name: 'Bronze', color: 'text-amber-700 bg-amber-700/10 border-amber-700/20' };
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-6">
        <div>
          <h2 className="text-3xl font-black text-brand-text mb-1 flex items-center gap-2">
            <Star className="text-brand-primary" size={28} /> CRM & Loyalty
          </h2>
          <p className="text-sm font-medium text-brand-text/50">Manage your customers and rewards</p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-brand-card rounded-2xl border border-brand-glass-border p-4 flex flex-col md:flex-row gap-4 mb-6 shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-primary" />
          <input 
            type="text" 
            placeholder="Search by name or phone..." 
            className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-shadow"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Main Table */}
      <div className="flex-1 overflow-hidden flex flex-col bg-brand-card border border-brand-glass-border rounded-2xl shadow-sm">
        <div className="overflow-x-auto w-full no-scrollbar flex-1 flex flex-col h-full">
          <div className="min-w-[800px] flex flex-col h-full">
            <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-brand-glass-border bg-brand-bg/30 text-[10px] font-black text-brand-text/40 tracking-widest uppercase">
              <div className="col-span-1">#</div>
              <div className="col-span-3">Name</div>
              <div className="col-span-2">Phone</div>
              <div className="col-span-2">Tier</div>
              <div className="col-span-2 text-right">Loyalty Points</div>
              <div className="col-span-1 text-right">Visits</div>
              <div className="col-span-1 text-right">Total Spent</div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 no-scrollbar relative">
              <AnimatePresence mode="popLayout">
                {filteredCustomers.length === 0 ? (
                  <motion.div 
                    layout
                    key="empty"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                    className="absolute inset-0 flex flex-col items-center justify-center text-brand-text/40 font-medium"
                  >
                    <Users size={48} className="mb-4 opacity-30" />
                    <p>No customers found</p>
                  </motion.div>
                ) : (
                  filteredCustomers.map((c, index) => {
                    const tier = getTier(c.total_spent);
                    return (
                      <motion.div
                        layout
                        key={c.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                        className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-brand-glass-border/30 items-center hover:bg-brand-secondary/10 transition-colors rounded-xl mx-2 mb-1"
                      >
                        <div className="col-span-1 text-xs font-bold text-brand-text/40">{index + 1}</div>
                        <div className="col-span-3 text-sm font-bold text-brand-text truncate flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-brand-secondary/50 flex items-center justify-center text-xs text-brand-text/50">
                            {c.name ? c.name.charAt(0).toUpperCase() : '?'}
                          </div>
                          {c.name || 'Walk-in Customer'}
                        </div>
                        <div className="col-span-2 text-xs font-medium text-brand-text/60">{c.phone || '-'}</div>
                        <div className="col-span-2">
                          <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest rounded-lg border ${tier.color} flex items-center gap-1 w-max`}>
                            <Award size={10} /> {tier.name}
                          </span>
                        </div>
                        <div className="col-span-2 text-right text-sm font-black text-brand-primary">{c.points}</div>
                        <div className="col-span-1 text-right text-xs font-medium text-brand-text/60">{c.visits}</div>
                        <div className="col-span-1 text-right text-xs font-bold text-brand-text">₹{Number(c.total_spent).toLocaleString()}</div>
                      </motion.div>
                    )
                  })
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
