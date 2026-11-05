import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Calendar as CalendarIcon, Search, Plus, Users, Clock, Phone, Mail, Edit2, CheckCircle2, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';

export default function Reservations({ tables }) {
  const [reservations, setReservations] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const fetchReservations = useCallback(async () => {
    const { data, error } = await supabase
      .from('reservations')
      .select('id, customer_name, phone, guest_count, reservation_date, reservation_time, table_no, status, notes')
      .order('reservation_date', { ascending: true })
      .order('reservation_time', { ascending: true });
    if (!error) setReservations(data || []);
  }, []);

  useEffect(() => {
    fetchReservations();
    let debounceTimer = null;
    const debouncedFetch = () => {
      if (document.hidden) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fetchReservations, 3000);
    };

    const sub = supabase
      .channel('reservations_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, debouncedFetch)
      .subscribe();

    return () => {
      clearTimeout(debounceTimer);
      supabase.removeChannel(sub);
    };
  }, [fetchReservations]);

  const filteredReservations = useMemo(() => {
    return reservations.filter(r => {
      const matchDate = r.reservation_date === selectedDate;
      const q = searchQuery.toLowerCase();
      const matchQuery = (r.customer_name && r.customer_name.toLowerCase().includes(q)) || 
                         (r.customer_phone && r.customer_phone.includes(q));
      return matchDate && (searchQuery ? matchQuery : true);
    });
  }, [reservations, searchQuery, selectedDate]);

  const handleUpdateStatus = async (id, newStatus) => {
    const { error } = await supabase
      .from('reservations')
      .update({ status: newStatus })
      .eq('id', id);
    if (error) {
      toast.error('Failed to update status');
    } else {
      toast.success(`Reservation marked as ${newStatus}`);
      fetchReservations();
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'Confirmed': return 'text-green-500 bg-green-500/10 border-green-500/20';
      case 'Seated': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
      case 'Completed': return 'text-slate-500 bg-slate-500/10 border-slate-500/20';
      case 'Cancelled': return 'text-red-500 bg-red-500/10 border-red-500/20';
      default: return 'text-amber-500 bg-amber-500/10 border-amber-500/20'; // Pending
    }
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-6">
        <div>
          <h2 className="text-3xl font-black text-brand-text mb-1 flex items-center gap-2">
            <CalendarIcon className="text-brand-primary" size={28} /> Reservations
          </h2>
          <p className="text-sm font-medium text-brand-text/50">Manage customer bookings and tables</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-brand-primary text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-brand-primary/20 flex items-center gap-2"
        >
          <Plus size={16} /> Add Reservation
        </button>
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
        <div className="flex-1 md:max-w-[200px]">
           <input 
            type="date"
            className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-2.5 text-sm font-medium text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/50 transition-shadow"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </div>
      </div>

      {/* Main Table */}
      <div className="flex-1 overflow-hidden flex flex-col bg-brand-card border border-brand-glass-border rounded-2xl shadow-sm">
        <div className="overflow-x-auto w-full no-scrollbar flex-1 flex flex-col h-full">
          <div className="min-w-[800px] flex flex-col h-full">
            <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-brand-glass-border bg-brand-bg/30 text-[10px] font-black text-brand-text/40 tracking-widest uppercase">
              <div className="col-span-2">Time</div>
              <div className="col-span-3">Customer</div>
              <div className="col-span-2">Contact</div>
              <div className="col-span-1">Party Size</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 no-scrollbar relative">
              <AnimatePresence mode="popLayout">
                {filteredReservations.length === 0 ? (
                  <motion.div 
                    layout
                    key="empty"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                    className="absolute inset-0 flex flex-col items-center justify-center text-brand-text/40 font-medium"
                  >
                    <CalendarIcon size={48} className="mb-4 opacity-30" />
                    <p>No reservations for this date</p>
                  </motion.div>
                ) : (
                  filteredReservations.map((r, index) => {
                    const statusColor = getStatusColor(r.status);
                    const formattedTime = new Date(`2000-01-01T${r.reservation_time}`).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                    
                    return (
                      <motion.div
                        layout
                        key={r.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                        className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-brand-glass-border/30 items-center hover:bg-brand-secondary/10 transition-colors rounded-xl mx-2 mb-1"
                      >
                        <div className="col-span-2 flex items-center gap-2 text-sm font-bold text-brand-text">
                           <Clock size={14} className="text-brand-text/40" />
                           {formattedTime}
                        </div>
                        <div className="col-span-3 text-sm font-bold text-brand-text truncate flex items-center gap-2">
                           <div className="w-8 h-8 rounded-full bg-brand-secondary/50 flex items-center justify-center text-xs text-brand-text/50 shrink-0">
                             {r.customer_name ? r.customer_name.charAt(0).toUpperCase() : '?'}
                           </div>
                           <div className="flex flex-col">
                             <span className="truncate">{r.customer_name}</span>
                             {r.special_requests && <span className="text-[10px] text-brand-text/40 font-medium truncate">{r.special_requests}</span>}
                           </div>
                        </div>
                        <div className="col-span-2 flex flex-col gap-1">
                          {r.customer_phone && <div className="text-xs font-medium text-brand-text/60 flex items-center gap-1"><Phone size={10} /> {r.customer_phone}</div>}
                          {r.customer_email && <div className="text-xs font-medium text-brand-text/60 flex items-center gap-1"><Mail size={10} /> {r.customer_email}</div>}
                        </div>
                        <div className="col-span-1 flex items-center gap-1 text-sm font-bold text-brand-text">
                           <Users size={14} className="text-brand-text/40" />
                           {r.party_size}
                        </div>
                        <div className="col-span-2">
                          <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest rounded-lg border ${statusColor} flex items-center gap-1 w-max`}>
                            {r.status}
                          </span>
                        </div>
                        <div className="col-span-2 flex justify-end gap-2">
                           {r.status === 'Pending' && (
                             <button onClick={() => handleUpdateStatus(r.id, 'Confirmed')} className="p-1.5 rounded-lg bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors" title="Confirm">
                               <CheckCircle2 size={16} />
                             </button>
                           )}
                           {(r.status === 'Confirmed' || r.status === 'Pending') && (
                             <button onClick={() => handleUpdateStatus(r.id, 'Seated')} className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors" title="Mark as Seated">
                               <Users size={16} />
                             </button>
                           )}
                           {r.status !== 'Cancelled' && r.status !== 'Completed' && (
                             <button onClick={() => handleUpdateStatus(r.id, 'Cancelled')} className="p-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors" title="Cancel">
                               <XCircle size={16} />
                             </button>
                           )}
                           {r.status === 'Seated' && (
                             <button onClick={() => handleUpdateStatus(r.id, 'Completed')} className="p-1.5 rounded-lg bg-slate-500/10 text-slate-500 hover:bg-slate-500/20 transition-colors" title="Complete">
                               <CheckCircle2 size={16} />
                             </button>
                           )}
                        </div>
                      </motion.div>
                    )
                  })
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <ReservationModal 
          onClose={() => setIsModalOpen(false)} 
          onSave={() => {
            setIsModalOpen(false);
            fetchReservations();
          }}
          selectedDate={selectedDate}
          tables={tables}
        />
      )}
    </div>
  );
}

function ReservationModal({ onClose, onSave, selectedDate, tables = [] }) {
  const [formData, setFormData] = useState({
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    party_size: 2,
    reservation_date: selectedDate,
    reservation_time: '19:00',
    special_requests: '',
    table_id: null
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.customer_name || !formData.reservation_date || !formData.reservation_time) {
      toast.error('Please fill in all required fields');
      return;
    }

    const { error } = await supabase.from('reservations').insert([formData]);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Reservation added successfully!');
      onSave();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-brand-card w-full max-w-md rounded-3xl border border-brand-glass-border shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b border-brand-glass-border flex justify-between items-center bg-brand-bg/50">
          <h3 className="text-xl font-black text-brand-text">New Reservation</h3>
          <button onClick={onClose} className="text-brand-text/40 hover:text-brand-text bg-brand-secondary/30 p-2 rounded-full transition-colors">
            <XCircle size={20} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-wider mb-2">Customer Name *</label>
            <input 
              type="text" required
              value={formData.customer_name}
              onChange={e => setFormData({...formData, customer_name: e.target.value})}
              className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-3 text-sm font-medium text-brand-text focus:outline-none focus:border-brand-primary transition-colors"
              placeholder="e.g. John Doe"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-wider mb-2">Phone</label>
              <input 
                type="tel"
                value={formData.customer_phone}
                onChange={e => setFormData({...formData, customer_phone: e.target.value.replace(/\D/g, '').slice(0, 10)})}
                className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-3 text-sm font-medium text-brand-text focus:outline-none focus:border-brand-primary transition-colors"
                placeholder="e.g. 9876543210"
                maxLength="10"
                pattern="[0-9]{10}"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-wider mb-2">Party Size *</label>
              <input 
                type="number" min="1" required
                value={formData.party_size}
                onChange={e => setFormData({...formData, party_size: parseInt(e.target.value)})}
                className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-3 text-sm font-medium text-brand-text focus:outline-none focus:border-brand-primary transition-colors"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-wider mb-2">Date *</label>
              <input 
                type="date" required
                value={formData.reservation_date}
                onChange={e => setFormData({...formData, reservation_date: e.target.value})}
                className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-3 text-sm font-medium text-brand-text focus:outline-none focus:border-brand-primary transition-colors [&::-webkit-calendar-picker-indicator]:filter [&::-webkit-calendar-picker-indicator]:invert"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-wider mb-2">Time *</label>
              <input 
                type="time" required
                value={formData.reservation_time}
                onChange={e => setFormData({...formData, reservation_time: e.target.value})}
                className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-3 text-sm font-medium text-brand-text focus:outline-none focus:border-brand-primary transition-colors [&::-webkit-calendar-picker-indicator]:filter [&::-webkit-calendar-picker-indicator]:invert"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-wider mb-2">Assign Table</label>
            <select 
              value={formData.table_id || ''}
              onChange={e => setFormData({...formData, table_id: e.target.value || null})}
              className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-3 text-sm font-medium text-brand-text focus:outline-none focus:border-brand-primary transition-colors appearance-none"
            >
              <option value="">No table assigned yet</option>
              {tables.map(t => (
                <option key={t.id} value={t.id}>Table {t.table_no} ({t.seats} seats)</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-wider mb-2">Special Requests</label>
            <textarea 
              value={formData.special_requests}
              onChange={e => setFormData({...formData, special_requests: e.target.value})}
              className="w-full bg-brand-bg/50 border border-brand-glass-border rounded-xl px-4 py-3 text-sm font-medium text-brand-text focus:outline-none focus:border-brand-primary transition-colors resize-none h-20"
              placeholder="e.g. Window seat, anniversary..."
            />
          </div>

          <div className="mt-4 flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 bg-brand-secondary/50 hover:bg-brand-secondary text-brand-text font-bold py-3 rounded-xl transition-colors">
              Cancel
            </button>
            <button type="submit" className="flex-1 bg-brand-primary hover:opacity-90 text-white font-bold py-3 rounded-xl shadow-lg shadow-brand-primary/20 transition-all">
              Save Reservation
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
