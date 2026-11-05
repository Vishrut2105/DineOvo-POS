import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Store, Receipt, Bell, Shield, Save, Map, AlertTriangle, X, CreditCard, Smartphone, Trash2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import FloorPlanBuilder from '../components/FloorPlanBuilder';
import { supabase } from '../lib/supabase';
import { getDeviceId, MAX_SESSIONS } from '../lib/session';

// Each section's underlying tables, in an order that's safe to run standalone. Cross-section
// foreign keys (salaries -> expenses, reservations -> tables, recipe_items -> menu/inventory)
// are handled separately in handleCustomDelete rather than baked in here, since which of those
// needs handling depends on which *other* sections are also selected in a given run.
const CUSTOM_DELETE_SECTIONS = [
  { key: 'orders', label: 'Orders & Sales History', desc: 'All orders, order items, and KDS history.' },
  { key: 'requests', label: 'Requests', desc: 'Water / waiter / clean requests log.' },
  { key: 'reservations', label: 'Reservations', desc: 'All table reservations.' },
  { key: 'menu', label: 'Menu Items', desc: 'All menu items and their recipe links.' },
  { key: 'inventory', label: 'Inventory', desc: 'All inventory / stock items and their recipe links.' },
  { key: 'employees', label: 'Employees & Salaries', desc: 'All employees and their salary payment history.' },
  { key: 'expenses', label: 'Expenses', desc: 'All expense records.' },
  { key: 'vendors', label: 'Vendors', desc: 'All vendor / supplier records.' },
  { key: 'customers', label: 'Customers', desc: 'All customer profiles and loyalty points.' },
  {
    key: 'tables',
    label: 'Floor Plan / Tables',
    desc: "This is the exact data that's been vanishing unexpectedly (see the RLS fix in database_scripts). Only clear it if you're intentionally redesigning the floor plan.",
    warn: true
  }
];

export default function Settings({ tables, refreshTables, daysLeft = 30, expiryDate }) {
  const [activeTab, setActiveTab] = useState('General');

  // General tab state
  const [businessName, setBusinessName] = useState('Cielo Cafe');
  const [currency, setCurrency] = useState('INR (\u20b9)');
  const [taxRate, setTaxRate] = useState('5');
  const [gstin, setGstin] = useState('');
  const [isWipeModalOpen, setIsWipeModalOpen] = useState(false);
  const [isFactoryResetModalOpen, setIsFactoryResetModalOpen] = useState(false);
  const [isCustomDeleteModalOpen, setIsCustomDeleteModalOpen] = useState(false);
  const [customDeleteSections, setCustomDeleteSections] = useState({});
  const [isCustomDeleting, setIsCustomDeleting] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);

  const [printSettings, setPrintSettings] = useState({
    print_business_name: 'CIELO cafe & resto',
    print_group_name: '(MIRA GROUP)',
    print_address_1: '6th floor, Asopalav One west, Sevasi -',
    print_address_2: 'Canal Rd , Vadodara, Gujarat 391101',
    print_phone: '9909377100',
    print_footer_1: 'THANK YOU...<br/>VISIT AGAIN...',
    print_footer_2: '\'Love our service? Leave us a quick<br/>review on google\'',
    print_logo_url: ''
  });
  const [logoFile, setLogoFile] = useState(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  // Low-stock toast alerts (App.jsx) are gated by this — a per-device display preference,
  // so it lives in localStorage rather than the shared app_settings table.
  const [lowStockAlerts, setLowStockAlerts] = useState(() => localStorage.getItem('dineovo_low_stock_alerts') !== 'false');
  const handleToggleLowStockAlerts = () => {
    const next = !lowStockAlerts;
    setLowStockAlerts(next);
    localStorage.setItem('dineovo_low_stock_alerts', String(next));
  };

  // Active Sessions state
  const [activeSessions, setActiveSessions] = useState([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  // device_id now persists outside localStorage in Electron (see lib/session.js), so this
  // resolves asynchronously instead of a synchronous localStorage read.
  const [currentDeviceId, setCurrentDeviceId] = useState('');
  useEffect(() => {
    getDeviceId().then(setCurrentDeviceId);
  }, []);

  const fetchActiveSessions = async () => {
    setIsLoadingSessions(true);
    try {
      // Scoped to the signed-in account — this table previously had no per-row RLS
      // restriction (`USING (true)` for any authenticated user) combined with an
      // unfiltered select here, so any logged-in account could see, and force-logout,
      // every OTHER account's devices too, not just its own.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('active_sessions')
        .select('id, device_id, device_name, last_active, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setActiveSessions(data || []);
    } catch (err) {
      console.error('Error fetching sessions:', err);
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const handleForceLogout = async (sessionId, deviceId) => {
    if (deviceId === currentDeviceId) {
      toast.error('You cannot force-logout your own device.');
      return;
    }
    try {
      const { error } = await supabase
        .from('active_sessions')
        .delete()
        .eq('id', sessionId);
      if (error) throw error;
      toast.success('Device has been logged out.');
      fetchActiveSessions();
    } catch (err) {
      toast.error('Failed to remove session: ' + err.message);
    }
  };

  // ─── Updates tab ───
  // The corner-toast notification (App.jsx) only fires once per version, on login — miss
  // it or dismiss it and there was previously no other way to check without restarting the
  // whole app. This gives a manual, always-available surface.
  const [appVersion, setAppVersion] = useState('');
  const [updateState, setUpdateState] = useState('idle'); // idle | checking | up-to-date | available | downloading | downloaded | error
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateProgressPercent, setUpdateProgressPercent] = useState(0);
  const [updateErrorMessage, setUpdateErrorMessage] = useState('');

  useEffect(() => {
    if (!window.electronAPI?.getAppVersion) return;
    window.electronAPI.getAppVersion().then(setAppVersion);
  }, []);

  useEffect(() => {
    if (activeTab !== 'Updates' || !window.electronAPI) return;

    // Registers its own listeners independent of App.jsx's corner-toast flow (see
    // preload.js) — each returns its own cleanup, so leaving this tab can't tear down the
    // other surface's listeners.
    const removeAvailable = window.electronAPI.onUpdateAvailable((info) => {
      setUpdateInfo(info);
      setUpdateState('available');
    });
    const removeNotAvailable = window.electronAPI.onUpdateNotAvailable(() => {
      setUpdateState('up-to-date');
    });
    const removeProgress = window.electronAPI.onUpdateProgress((progressObj) => {
      setUpdateState('downloading');
      setUpdateProgressPercent(Math.round(progressObj.percent || 0));
    });
    const removeDownloaded = window.electronAPI.onUpdateDownloaded(() => {
      setUpdateState('downloaded');
    });
    const removeError = window.electronAPI.onUpdateError((message) => {
      setUpdateErrorMessage(message || 'Unknown error');
      setUpdateState('error');
    });

    return () => {
      removeAvailable?.();
      removeNotAvailable?.();
      removeProgress?.();
      removeDownloaded?.();
      removeError?.();
    };
  }, [activeTab]);

  const handleCheckForUpdates = () => {
    if (!window.electronAPI) return;
    setUpdateState('checking');
    window.electronAPI.checkForUpdates();
  };

  const handleDownloadUpdate = () => {
    setUpdateState('downloading');
    setUpdateProgressPercent(0);
    window.electronAPI.startDownload();
  };

  const handleInstallUpdate = () => {
    window.electronAPI.installUpdate();
  };

  const toggleCustomDeleteSection = (key) => {
    setCustomDeleteSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCustomDelete = async () => {
    const selected = customDeleteSections;
    if (!Object.values(selected).some(Boolean)) {
      toast.error('Select at least one section to delete.');
      return;
    }

    const password = document.getElementById('customDeletePinInput').value;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error('Authentication error.');
      return;
    }
    const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password });
    if (authError) {
      toast.error('Incorrect password. Deletion aborted.');
      return;
    }

    setIsCustomDeleting(true);
    const failed = [];
    const del = async (table) => {
      const { error } = await supabase.from(table).delete().not('id', 'is', null);
      if (error) failed.push(`${table}: ${error.message}`);
    };

    try {
      // Children before parents, and cross-section FK links resolved with a best-effort
      // nullify (ignored if it errors, e.g. the column doesn't exist on this install) so
      // deleting one section never blocks on, or silently deletes, an unselected one.
      if (selected.orders) {
        await supabase.from('orders').update({ merged_into: null }).not('merged_into', 'is', null);
        await del('order_items');
        await del('orders');
      }
      if (selected.requests) await del('requests');
      if (selected.reservations) await del('reservations');
      if (selected.menu || selected.inventory) await del('recipe_items');
      if (selected.menu) await del('menu_items');
      if (selected.inventory) await del('inventory');
      if (selected.employees) {
        await del('salaries');
        await del('employees');
      }
      if (selected.expenses) {
        await supabase.from('salaries').update({ expense_id: null }).not('expense_id', 'is', null);
        await del('expenses');
      }
      if (selected.vendors) await del('vendors');
      if (selected.customers) await del('customers');
      if (selected.tables) {
        await supabase.from('reservations').update({ table_id: null }).not('table_id', 'is', null);
        await del('tables');
      }

      if (failed.length > 0) {
        toast.error(`Deletion incomplete — ${failed.length} section(s) failed. ${failed.join(' | ')}`, { duration: 15000 });
      } else {
        toast.success('Selected data deleted successfully.');
        setIsCustomDeleteModalOpen(false);
        setCustomDeleteSections({});
        if (selected.tables) refreshTables();
      }
    } catch (err) {
      toast.error('Failed to delete data: ' + err.message);
    } finally {
      setIsCustomDeleting(false);
    }
  };

  React.useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    if (activeTab === 'Security') {
      fetchActiveSessions();
    }
  }, [activeTab]);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase.from('app_settings').select('key, value');
      if (error) throw error;
      
      if (data && data.length > 0) {
        const settingsMap = {};
        data.forEach(item => { settingsMap[item.key] = item.value; });
        setPrintSettings(prev => ({ ...prev, ...settingsMap }));
        localStorage.setItem('print_settings', JSON.stringify(settingsMap));

        // General/Billing tab fields — these used to be local-only state that reset to the
        // hardcoded defaults on every reopen ("Save Changes" silently didn't save them).
        if (settingsMap.business_name !== undefined) setBusinessName(settingsMap.business_name);
        if (settingsMap.currency !== undefined) setCurrency(settingsMap.currency);
        if (settingsMap.tax_rate !== undefined) setTaxRate(settingsMap.tax_rate);
        if (settingsMap.gstin !== undefined) setGstin(settingsMap.gstin);
      }
    } catch (err) {
      console.error('Error fetching settings:', err);
      // Fallback to local storage if offline
      const local = localStorage.getItem('print_settings');
      if (local) {
        setPrintSettings(prev => ({ ...prev, ...JSON.parse(local) }));
      }
    }
  };

  const handlePrintSettingsChange = (key, value) => {
    setPrintSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleLogoChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setLogoFile(e.target.files[0]);
    }
  };

  const handleSave = async () => {
    const toastId = toast.loading('Saving settings...');
    try {
      let finalLogoUrl = printSettings.print_logo_url;
      
      if (logoFile) {
        setIsUploadingLogo(true);
        const fileExt = logoFile.name.split('.').pop();
        const fileName = `logo_${Date.now()}.${fileExt}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('receipt-assets')
          .upload(fileName, logoFile, { upsert: true });
          
        if (uploadError) throw uploadError;
        
        const { data: { publicUrl } } = supabase.storage
          .from('receipt-assets')
          .getPublicUrl(fileName);
          
        finalLogoUrl = publicUrl;
        setIsUploadingLogo(false);
      }

      const settingsToSave = {
        ...printSettings,
        print_logo_url: finalLogoUrl,
        business_name: businessName,
        currency,
        tax_rate: taxRate,
        gstin
      };

      // Upsert each setting
      for (const [key, value] of Object.entries(settingsToSave)) {
        await supabase.from('app_settings').upsert(
          { key, value: value || '' },
          { onConflict: 'key' }
        );
      }
      
      localStorage.setItem('print_settings', JSON.stringify(settingsToSave));
      setPrintSettings(settingsToSave);
      setLogoFile(null);
      
      toast.success('Settings saved successfully!', { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error('Failed to save settings: ' + err.message, { id: toastId });
      setIsUploadingLogo(false);
    }
  };

  const tabs = [
    { id: 'General', icon: Store, label: 'General Info' },
    { id: 'FloorPlan', icon: Map, label: 'Floor Plan' },
    { id: 'PrintReceipts', icon: Receipt, label: 'Print & Receipts' },
    { id: 'Billing', icon: Receipt, label: 'Tax & Billing' },
    { id: 'Subscription', icon: CreditCard, label: 'Subscription Plan' },
    { id: 'Notifications', icon: Bell, label: 'Notifications' },
    { id: 'Security', icon: Shield, label: 'Security & Data' },
    { id: 'Updates', icon: RefreshCw, label: 'Updates' },
  ];

  return (
    <div className="flex flex-col gap-6 animate-fade-in max-w-6xl mx-auto w-full">
      <div className="flex justify-between items-start md:items-center flex-col md:flex-row gap-4 mb-2">
        <div>
          <h1 className="text-3xl font-black text-brand-text mb-1 tracking-tight">Settings</h1>
          <p className="text-brand-text/50 font-medium">Manage your cafe preferences</p>
        </div>
        <button 
          onClick={handleSave}
          className="btn bg-brand-primary text-white font-bold hover:bg-brand-primary/90 shadow-lg shadow-brand-primary/20 transition-all px-6"
        >
          <Save size={18} /> Save Changes
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        
        {/* Sidebar Tabs */}
        <div className="w-full lg:w-64 flex flex-col gap-2 shrink-0">
          {tabs.map(tab => (
             <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-3 px-5 py-3.5 rounded-xl text-sm font-bold transition-all ${
                  activeTab === tab.id 
                    ? 'bg-brand-primary text-white shadow-md shadow-brand-primary/20' 
                    : 'bg-brand-card border border-brand-glass-border text-brand-text/60 hover:text-brand-text hover:border-brand-primary/50'
                }`}
             >
               <tab.icon size={18} /> {tab.label}
             </button>
          ))}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 bg-brand-card rounded-2xl border border-brand-glass-border p-8 min-h-[500px] shadow-sm relative overflow-hidden">
           
           {activeTab === 'General' && (
             <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col gap-6">
               <div className="flex justify-between items-center border-b border-brand-glass-border pb-4 mb-2">
                 <h2 className="text-xl font-bold text-brand-text">General Settings</h2>
               </div>
               
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="md:col-span-2">
                   <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Business Name</label>
                   <input type="text" value={businessName} onChange={e => setBusinessName(e.target.value)} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors font-medium" />
                 </div>

                 <div>
                   <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Currency Symbol</label>
                   <select value={currency} onChange={e => setCurrency(e.target.value)} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-brand-primary/50 appearance-none font-medium">
                     <option>INR (₹)</option>
                     <option>USD ($)</option>
                     <option>EUR (€)</option>
                     <option>GBP (£)</option>
                   </select>
                 </div>

                 <div>
                   <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Timezone</label>
                   <select className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-brand-primary/50 appearance-none font-medium">
                     <option>Asia/Kolkata (IST)</option>
                     <option>America/New_York (EST)</option>
                     <option>Europe/London (GMT)</option>
                     <option>Australia/Sydney (AEST)</option>
                   </select>
                 </div>
               </div>
             </motion.div>
           )}

           {activeTab === 'FloorPlan' && (
             <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="h-full">
               <FloorPlanBuilder tables={tables} refreshTables={refreshTables} />
             </motion.div>
           )}

           {activeTab === 'PrintReceipts' && (
             <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col gap-6">
               <div className="flex justify-between items-center border-b border-brand-glass-border pb-4 mb-2">
                 <h2 className="text-xl font-bold text-brand-text">Receipt Configuration</h2>
               </div>
               
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="md:col-span-2">
                   <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Receipt Logo</label>
                   <div className="flex items-center gap-4">
                     {(logoFile || printSettings.print_logo_url) && (
                       <img 
                         src={logoFile ? URL.createObjectURL(logoFile) : printSettings.print_logo_url} 
                         alt="Logo Preview" 
                         className="h-16 object-contain bg-white rounded-lg p-1 border border-brand-glass-border"
                       />
                     )}
                     <input type="file" accept="image/*" onChange={handleLogoChange} className="block w-full text-sm text-brand-text/70 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-brand-primary file:text-white hover:file:bg-brand-primary/90" />
                   </div>
                 </div>

                 <div>
                   <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Business Name (Header)</label>
                   <input type="text" value={printSettings.print_business_name} onChange={e => handlePrintSettingsChange('print_business_name', e.target.value)} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors font-medium" />
                 </div>

                 <div>
                   <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Group Name / Subtitle</label>
                   <input type="text" value={printSettings.print_group_name} onChange={e => handlePrintSettingsChange('print_group_name', e.target.value)} placeholder="(MIRA GROUP)" className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors font-medium" />
                 </div>

                 <div>
                   <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Address Line 1</label>
                   <input type="text" value={printSettings.print_address_1} onChange={e => handlePrintSettingsChange('print_address_1', e.target.value)} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors font-medium" />
                 </div>

                 <div>
                   <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Address Line 2</label>
                   <input type="text" value={printSettings.print_address_2} onChange={e => handlePrintSettingsChange('print_address_2', e.target.value)} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors font-medium" />
                 </div>

                 <div>
                   <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Phone Number</label>
                   <input type="text" value={printSettings.print_phone} onChange={e => handlePrintSettingsChange('print_phone', e.target.value)} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors font-medium" />
                 </div>

                 <div className="md:col-span-2 mt-4 border-t border-brand-glass-border pt-4">
                   <h3 className="text-sm font-bold text-brand-text mb-4">Footer Messages</h3>
                 </div>

                 <div>
                   <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Footer Text 1 (Use &lt;br/&gt; for new line)</label>
                   <textarea rows="2" value={printSettings.print_footer_1} onChange={e => handlePrintSettingsChange('print_footer_1', e.target.value)} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors font-medium text-xs font-mono" />
                 </div>

                 <div>
                   <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Footer Text 2 (Review Link)</label>
                   <textarea rows="2" value={printSettings.print_footer_2} onChange={e => handlePrintSettingsChange('print_footer_2', e.target.value)} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors font-medium text-xs font-mono" />
                 </div>
               </div>
             </motion.div>
           )}

           {activeTab === 'Billing' && (
             <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col gap-6">
               <h2 className="text-xl font-bold border-b border-brand-glass-border pb-4 mb-2 text-brand-text">Tax & Billing</h2>
               
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div>
                   <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Default Tax Rate (%)</label>
                   <input type="number" value={taxRate} onChange={e => setTaxRate(e.target.value)} className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors font-medium" />
                   <p className="text-xs text-brand-text/40 mt-2">This tax rate will be automatically applied to invoices and reports.</p>
                 </div>

                 <div>
                   <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">GSTIN / Tax Identification Number</label>
                   <input type="text" value={gstin} onChange={e => setGstin(e.target.value)} placeholder="e.g. 22AAAAA0000A1Z5" className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-brand-primary/50 transition-colors font-medium" />
                 </div>
               </div>
             </motion.div>
           )}

           {activeTab === 'Subscription' && (
             <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col gap-6">
               <h2 className="text-xl font-bold border-b border-brand-glass-border pb-4 mb-2 text-brand-text">Subscription Details</h2>
               
               <div className="bg-linear-to-br from-brand-primary/20 to-brand-secondary/10 border border-brand-primary/30 rounded-3xl p-8 relative overflow-hidden shadow-lg shadow-brand-primary/5">
                 {/* Decorative element */}
                 <div className="absolute top-0 right-0 w-64 h-64 bg-brand-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4"></div>
                 
                 <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                   <div>
                     <div className="flex items-center gap-3 mb-2">
                       <div className="bg-brand-primary/20 p-2.5 rounded-xl border border-brand-primary/30">
                         <CreditCard className="text-brand-primary" size={24} />
                       </div>
                       <h3 className="text-2xl font-black text-brand-text">Premium Plan</h3>
                       <span className="px-3 py-1 bg-green-500/20 border border-green-500/30 text-green-500 text-[10px] font-bold uppercase tracking-widest rounded-full">Active</span>
                     </div>
                     <p className="text-brand-text/60 font-medium max-w-sm mt-4 leading-relaxed">
                       Full access to all POS features, KDS, inventory tracking, analytics, and unlimited users.
                     </p>
                   </div>
                   
                   <div className="text-left md:text-right bg-brand-bg/50 p-6 rounded-2xl border border-brand-glass-border/50 backdrop-blur-md">
                     <p className="text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-1">Current Cycle</p>
                     <div className="text-4xl font-black text-brand-text mb-1">
                       {daysLeft} <span className="text-lg font-medium text-brand-text/50">Days Left</span>
                     </div>
                     <p className="text-brand-primary font-bold text-sm">Renews on {expiryDate ? new Date(expiryDate).toLocaleDateString() : 'N/A'}</p>
                   </div>
                 </div>
                 
                 <div className="mt-8 pt-6 border-t border-brand-glass-border/50 relative z-10">
                   <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                     <div>
                       <p className="text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-1">Pricing Plan</p>
                       <p className="text-2xl font-black text-brand-text">₹6,500 <span className="text-sm font-medium text-brand-text/50">/ year</span></p>
                     </div>
                     <div className="flex gap-3 w-full md:w-auto">
                       <button onClick={() => setIsInvoiceModalOpen(true)} className="flex-1 md:flex-none px-6 py-3 bg-brand-secondary/50 hover:bg-brand-secondary border border-brand-glass-border rounded-xl font-bold text-brand-text transition-colors">
                         View Invoices
                       </button>
                       <button onClick={() => setIsPaymentModalOpen(true)} className="flex-1 md:flex-none px-6 py-3 bg-brand-primary hover:opacity-90 rounded-xl font-bold text-white shadow-lg shadow-brand-primary/20 transition-all">
                         Renew Now
                       </button>
                     </div>
                   </div>
                 </div>
               </div>
             </motion.div>
           )}

           {activeTab === 'Notifications' && (
             <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col gap-6">
               <h2 className="text-xl font-bold border-b border-brand-glass-border pb-4 mb-2 text-brand-text">Notifications & Alerts</h2>
               
               <div className="flex items-center justify-between p-5 bg-brand-bg rounded-xl border border-brand-glass-border opacity-60">
                 <div>
                   <h4 className="font-bold text-brand-text mb-1">Daily Summary Emails <span className="text-[10px] font-black uppercase tracking-widest text-brand-text/40 ml-1">Coming Soon</span></h4>
                   <p className="text-sm text-brand-text/50">Receive a daily breakdown of sales, expenses, and net profit.</p>
                 </div>
                 <label className="relative inline-flex items-center cursor-not-allowed">
                   <input type="checkbox" className="sr-only peer" checked={false} disabled readOnly />
                   <div className="w-11 h-6 bg-brand-glass-border rounded-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5"></div>
                 </label>
               </div>

               <div className="flex items-center justify-between p-5 bg-brand-bg rounded-xl border border-brand-glass-border hover:border-brand-primary/30 transition-colors">
                 <div>
                   <h4 className="font-bold text-brand-text mb-1">Low Inventory Alerts</h4>
                   <p className="text-sm text-brand-text/50">Get an urgent notification when stock drops below minimum levels.</p>
                 </div>
                 <label className="relative inline-flex items-center cursor-pointer">
                   <input type="checkbox" className="sr-only peer" checked={lowStockAlerts} onChange={handleToggleLowStockAlerts} />
                   <div className="w-11 h-6 bg-brand-glass-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-primary"></div>
                 </label>
               </div>
             </motion.div>
           )}

           {activeTab === 'Security' && (
             <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col gap-6">
               
               {/* Active Sessions Section */}
               <div className="flex justify-between items-center border-b border-brand-glass-border pb-4 mb-2">
                 <div>
                   <h2 className="text-xl font-bold text-brand-text flex items-center gap-2">
                     <Smartphone size={20} className="text-brand-primary" />
                     Active Sessions
                   </h2>
                   <p className="text-sm text-brand-text/50 mt-1">Devices currently logged into DineOvo (Max {MAX_SESSIONS} allowed)</p>
                 </div>
                 <button onClick={fetchActiveSessions} className="p-2 rounded-lg bg-brand-bg border border-brand-glass-border hover:border-brand-primary/50 transition-colors text-brand-text/60 hover:text-brand-primary">
                   <RefreshCw size={16} className={isLoadingSessions ? 'animate-spin' : ''} />
                 </button>
               </div>

               {activeSessions.length === 0 ? (
                 <div className="text-center py-8 text-brand-text/40">
                   <Smartphone size={32} className="mx-auto mb-2 opacity-50" />
                   <p className="font-medium">No active sessions</p>
                 </div>
               ) : (
                 <div className="flex flex-col gap-3">
                   {activeSessions.map(session => (
                     <div key={session.id} className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
                       session.device_id === currentDeviceId
                         ? 'bg-brand-primary/5 border-brand-primary/30'
                         : 'bg-brand-bg border-brand-glass-border hover:border-brand-primary/30'
                     }`}>
                       <div className="flex items-center gap-3">
                         <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                           session.device_id === currentDeviceId ? 'bg-brand-primary/10 text-brand-primary' : 'bg-brand-secondary/30 text-brand-text/50'
                         }`}>
                           <Smartphone size={18} />
                         </div>
                         <div>
                           <h4 className="font-bold text-brand-text text-sm flex items-center gap-2">
                             {session.device_name || 'Unknown Device'}
                             {session.device_id === currentDeviceId && (
                               <span className="text-[10px] font-black bg-brand-primary/15 text-brand-primary px-2 py-0.5 rounded-full uppercase tracking-wider">This Device</span>
                             )}
                           </h4>
                           <p className="text-xs text-brand-text/40 mt-0.5">
                             Last active: {new Date(session.last_active).toLocaleString()}
                             {' · '}Registered: {new Date(session.created_at).toLocaleString()}
                           </p>
                         </div>
                       </div>
                       {session.device_id !== currentDeviceId && (
                         <button
                           onClick={() => handleForceLogout(session.id, session.device_id)}
                           className="flex items-center gap-1.5 px-4 py-2 bg-red-500/10 text-red-500 rounded-xl font-bold text-xs hover:bg-red-500 hover:text-white transition-colors"
                         >
                           <Trash2 size={14} />
                           Force Logout
                         </button>
                       )}
                     </div>
                   ))}
                 </div>
               )}

               {/* Danger Zone */}
               <h2 className="text-xl font-bold border-b border-red-500/20 pb-4 mb-2 text-red-500 mt-6">Danger Zone</h2>
               <p className="text-sm text-brand-text/50 mb-2">Proceed with caution. These actions are highly destructive and cannot be reversed.</p>
               
               <div className="flex items-center justify-between p-5 bg-red-500/5 rounded-xl border border-red-500/20">
                 <div>
                   <h4 className="font-bold text-red-500 mb-1">Clear All Orders</h4>
                   <p className="text-sm text-red-500/60">Permanently delete all sales history and KDS data.</p>
                 </div>
                 <button onClick={() => setIsWipeModalOpen(true)} className="px-5 py-2.5 bg-red-500/10 text-red-500 rounded-xl font-bold text-sm hover:bg-red-500 hover:text-white transition-colors">Wipe Sales Data</button>
               </div>

               <div className="flex items-center justify-between p-5 bg-red-500/5 rounded-xl border border-red-500/20">
                 <div>
                   <h4 className="font-bold text-red-500 mb-1">Factory Reset Database</h4>
                   <p className="text-sm text-red-500/60">Wipe the entire system clean (except schema structure).</p>
                 </div>
                 <button onClick={() => setIsFactoryResetModalOpen(true)} className="px-5 py-2.5 bg-red-500 text-white rounded-xl font-bold text-sm hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20">Factory Reset</button>
               </div>

               <div className="flex items-center justify-between p-5 bg-red-500/5 rounded-xl border border-red-500/20">
                 <div>
                   <h4 className="font-bold text-red-500 mb-1">Custom Delete</h4>
                   <p className="text-sm text-red-500/60">Pick exactly which sections of data to permanently delete.</p>
                 </div>
                 <button onClick={() => { setCustomDeleteSections({}); setIsCustomDeleteModalOpen(true); }} className="px-5 py-2.5 bg-red-500/10 text-red-500 rounded-xl font-bold text-sm hover:bg-red-500 hover:text-white transition-colors">Select Data to Delete</button>
               </div>
             </motion.div>
           )}

           {activeTab === 'Updates' && (
             <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col gap-6">
               <div className="border-b border-brand-glass-border pb-4 mb-2">
                 <h2 className="text-xl font-bold text-brand-text flex items-center gap-2">
                   <RefreshCw size={20} className="text-brand-primary" />
                   Software Updates
                 </h2>
                 <p className="text-sm text-brand-text/50 mt-1">
                   {window.electronAPI ? 'Check for and install the latest version manually, without waiting for the login notification.' : 'Updates are only available in the desktop app.'}
                 </p>
               </div>

               {!window.electronAPI ? (
                 <div className="text-center py-8 text-brand-text/40">
                   <p className="font-medium">Not running in the desktop app.</p>
                 </div>
               ) : (
                 <div className="flex flex-col gap-4">
                   <div className="flex items-center justify-between p-5 bg-brand-bg rounded-xl border border-brand-glass-border">
                     <div>
                       <h4 className="font-bold text-brand-text mb-1">Current Version</h4>
                       <p className="text-sm text-brand-text/50">{appVersion ? `v${appVersion}` : 'Loading...'}</p>
                     </div>
                     <button
                       onClick={handleCheckForUpdates}
                       disabled={updateState === 'checking' || updateState === 'downloading'}
                       className="flex items-center gap-2 px-5 py-2.5 bg-brand-primary text-white rounded-xl font-bold text-sm hover:bg-brand-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                     >
                       <RefreshCw size={16} className={updateState === 'checking' ? 'animate-spin' : ''} />
                       {updateState === 'checking' ? 'Checking...' : 'Check for Updates'}
                     </button>
                   </div>

                   {updateState === 'up-to-date' && (
                     <div className="p-5 bg-green-500/5 rounded-xl border border-green-500/20 text-green-600 dark:text-green-400 font-medium text-sm">
                       You're on the latest version.
                     </div>
                   )}

                   {updateState === 'available' && (
                     <div className="flex items-center justify-between p-5 bg-brand-primary/5 rounded-xl border border-brand-primary/20">
                       <div>
                         <h4 className="font-bold text-brand-text mb-1">Update Available{updateInfo?.version ? ` — v${updateInfo.version}` : ''}</h4>
                         <p className="text-sm text-brand-text/50">A new version is ready to download.</p>
                       </div>
                       <button onClick={handleDownloadUpdate} className="px-5 py-2.5 bg-brand-primary text-white rounded-xl font-bold text-sm hover:bg-brand-primary/90 transition-colors">
                         Download
                       </button>
                     </div>
                   )}

                   {updateState === 'downloading' && (
                     <div className="p-5 bg-brand-bg rounded-xl border border-brand-glass-border">
                       <div className="flex justify-between items-center mb-2">
                         <h4 className="font-bold text-brand-text">Downloading...</h4>
                         <span className="text-sm font-bold text-brand-primary">{updateProgressPercent}%</span>
                       </div>
                       <div className="w-full h-2 bg-brand-secondary/30 rounded-full overflow-hidden">
                         <div className="h-full bg-brand-primary transition-all duration-300" style={{ width: `${updateProgressPercent}%` }}></div>
                       </div>
                     </div>
                   )}

                   {updateState === 'downloaded' && (
                     <div className="flex items-center justify-between p-5 bg-green-500/5 rounded-xl border border-green-500/20">
                       <div>
                         <h4 className="font-bold text-brand-text mb-1">Ready to Install</h4>
                         <p className="text-sm text-brand-text/50">The app will restart to finish installing.</p>
                       </div>
                       <button onClick={handleInstallUpdate} className="px-5 py-2.5 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 transition-colors">
                         Restart & Install
                       </button>
                     </div>
                   )}

                   {updateState === 'error' && (
                     <div className="p-5 bg-red-500/5 rounded-xl border border-red-500/20">
                       <h4 className="font-bold text-red-500 mb-1">Update Failed</h4>
                       <p className="text-sm text-red-500/60">{updateErrorMessage}</p>
                     </div>
                   )}
                 </div>
               )}
             </motion.div>
           )}

        </div>
      </div>

      {createPortal(
        <AnimatePresence>
          {isWipeModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsWipeModalOpen(false)}></motion.div>
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 10 }} 
                animate={{ opacity: 1, scale: 1, y: 0 }} 
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-brand-card rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden z-10 relative border border-red-500/30"
              >
                <div className="flex justify-between items-center p-5 border-b border-brand-glass-border bg-red-500/5">
                  <h2 className="text-lg font-black text-red-500 flex items-center gap-2">
                    <AlertTriangle size={20} />
                    Confirm Data Wipe
                  </h2>
                  <button className="text-brand-text/50 hover:text-brand-text hover:bg-brand-secondary/50 p-1.5 rounded-lg transition-colors" onClick={() => setIsWipeModalOpen(false)}>
                    <X size={20} />
                  </button>
                </div>
                <div className="p-6">
                  <p className="text-brand-text font-medium mb-2">Are you absolutely sure you want to delete all sales data?</p>
                  <p className="text-sm text-brand-text/60 mb-6">This will permanently delete all orders, KDS history, and revenue records. This action cannot be undone.</p>
                  
                  <div className="mb-6">
                    <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Enter Admin Password to Confirm</label>
                    <input 
                      type="password" 
                      placeholder="Enter Password"
                      id="wipePinInput"
                      className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-red-500/50 transition-colors font-medium text-center tracking-widest" 
                    />
                  </div>

                  <div className="flex gap-3">
                    <button className="flex-1 bg-brand-bg hover:bg-brand-secondary/50 border border-brand-glass-border text-brand-text font-bold py-3 rounded-xl transition-colors" onClick={() => setIsWipeModalOpen(false)}>Cancel</button>
                    <button className="flex-[2] bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-red-500/20 flex items-center justify-center gap-2" onClick={async () => {
                      const password = document.getElementById('wipePinInput').value;
                      const { data: { user } } = await supabase.auth.getUser();
                      if (!user) {
                        toast.error('Authentication error.');
                        return;
                      }
                      const { error: authError } = await supabase.auth.signInWithPassword({
                        email: user.email,
                        password: password
                      });
                      if (authError) {
                        toast.error('Incorrect password. Wipe aborted.');
                        return;
                      }
                      
                      try {
                        await supabase.from('order_items').delete().gte('id', '00000000-0000-0000-0000-000000000000');
                        await supabase.from('orders').delete().gte('id', '00000000-0000-0000-0000-000000000000');
                        toast.success('Sales data successfully wiped.');
                        setIsWipeModalOpen(false);
                      } catch (err) {
                        toast.error('Failed to wipe data: ' + err.message);
                      }
                    }}>
                      Yes, Wipe Data
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
          {isFactoryResetModalOpen && (
            <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsFactoryResetModalOpen(false)}></motion.div>
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 10 }} 
                animate={{ opacity: 1, scale: 1, y: 0 }} 
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-brand-card rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden z-10 relative border border-red-500/30"
              >
                <div className="flex justify-between items-center p-5 border-b border-brand-glass-border bg-red-500/5">
                  <h2 className="text-lg font-black text-red-500 flex items-center gap-2">
                    <AlertTriangle size={20} />
                    Confirm Factory Reset
                  </h2>
                  <button className="text-brand-text/50 hover:text-brand-text hover:bg-brand-secondary/50 p-1.5 rounded-lg transition-colors" onClick={() => setIsFactoryResetModalOpen(false)}>
                    <X size={20} />
                  </button>
                </div>
                <div className="p-6">
                  <p className="text-brand-text font-medium mb-2">Are you absolutely sure you want to FACTORY RESET?</p>
                  <p className="text-sm text-brand-text/60 mb-6">This will permanently delete all orders, menu items, employees, vendors, and inventory. This action cannot be undone.</p>
                  
                  <div className="mb-6">
                    <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Enter Admin Password to Confirm</label>
                    <input 
                      type="password" 
                      placeholder="Enter Password"
                      id="resetPinInput"
                      className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-red-500/50 transition-colors font-medium text-center tracking-widest" 
                    />
                  </div>

                  <div className="flex gap-3">
                    <button className="flex-1 bg-brand-bg hover:bg-brand-secondary/50 border border-brand-glass-border text-brand-text font-bold py-3 rounded-xl transition-colors" onClick={() => setIsFactoryResetModalOpen(false)}>Cancel</button>
                    <button className="flex-2 bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-red-500/20 flex items-center justify-center gap-2" onClick={async () => {
                      const password = document.getElementById('resetPinInput').value;
                      const { data: { user } } = await supabase.auth.getUser();
                      if (!user) {
                        toast.error('Authentication error.');
                        return;
                      }
                      const { error: authError } = await supabase.auth.signInWithPassword({
                        email: user.email,
                        password: password
                      });
                      if (authError) {
                        toast.error('Incorrect password. Factory Reset aborted.');
                        return;
                      }
                      
                      try {
                        // orders.merged_into is a self-referencing FK with no ON DELETE action,
                        // so any previously-merged order blocks the orders delete. Clear the
                        // links first (best-effort: ignore the error if the column isn't there).
                        await supabase.from('orders').update({ merged_into: null }).not('merged_into', 'is', null);

                        // Children before parents, so foreign keys don't block the delete.
                        const tables = ['order_items', 'requests', 'reservations', 'salaries', 'expenses', 'employees', 'recipe_items', 'orders', 'menu_items', 'inventory', 'vendors', 'customers'];
                        const failed = [];
                        for (const table of tables) {
                          // supabase-js RESOLVES with { error } instead of throwing, so each
                          // result has to be inspected — the previous version swallowed every
                          // failure and reported success regardless. `.not('id','is',null)`
                          // matches all rows whatever the id type (the old .gte(id,'000…')
                          // filter assumed UUID ids and errored on integer ones).
                          const { error } = await supabase.from(table).delete().not('id', 'is', null);
                          if (error) failed.push(`${table}: ${error.message}`);
                        }

                        if (failed.length > 0) {
                          toast.error(`Reset incomplete — ${failed.length} table(s) did not clear. ${failed.join(' | ')}`, { duration: 15000 });
                          return;
                        }

                        toast.success('Factory Reset complete. All data wiped.');
                        setIsFactoryResetModalOpen(false);
                      } catch (err) {
                        toast.error('Failed to factory reset: ' + err.message);
                      }
                    }}>
                      Yes, Factory Reset
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
          {isCustomDeleteModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsCustomDeleteModalOpen(false)}></motion.div>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-brand-card rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden z-10 relative border border-red-500/30 max-h-[90vh]"
              >
                <div className="flex justify-between items-center p-5 border-b border-brand-glass-border bg-red-500/5 shrink-0">
                  <h2 className="text-lg font-black text-red-500 flex items-center gap-2">
                    <AlertTriangle size={20} />
                    Custom Delete
                  </h2>
                  <button className="text-brand-text/50 hover:text-brand-text hover:bg-brand-secondary/50 p-1.5 rounded-lg transition-colors" onClick={() => setIsCustomDeleteModalOpen(false)}>
                    <X size={20} />
                  </button>
                </div>
                <div className="p-6 overflow-y-auto">
                  <p className="text-brand-text font-medium mb-1">Choose exactly which data to permanently delete.</p>
                  <p className="text-sm text-brand-text/60 mb-4">Only the sections checked below are affected. This action cannot be undone.</p>

                  <div className="flex flex-col gap-2 mb-4">
                    {CUSTOM_DELETE_SECTIONS.map(({ key, label, desc, warn }) => (
                      <label key={key} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${customDeleteSections[key] ? (warn ? 'bg-amber-500/10 border-amber-500/40' : 'bg-red-500/10 border-red-500/30') : 'bg-brand-bg border-brand-glass-border hover:border-red-500/20'}`}>
                        <input
                          type="checkbox"
                          className="w-4 h-4 mt-0.5 rounded text-red-500 bg-brand-bg border-brand-glass-border focus:ring-red-500 shrink-0"
                          checked={!!customDeleteSections[key]}
                          onChange={() => toggleCustomDeleteSection(key)}
                        />
                        <span>
                          <span className="block text-sm font-bold text-brand-text">{label}</span>
                          <span className={`block text-xs mt-0.5 ${warn ? 'text-amber-600 dark:text-amber-400' : 'text-brand-text/50'}`}>{desc}</span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <div className="mb-4">
                    <label className="block text-xs font-bold text-brand-text/50 uppercase tracking-widest mb-2">Enter Admin Password to Confirm</label>
                    <input
                      type="password"
                      placeholder="Enter Password"
                      id="customDeletePinInput"
                      className="w-full bg-brand-bg border border-brand-glass-border rounded-xl px-4 py-3 text-brand-text focus:outline-none focus:border-red-500/50 transition-colors font-medium text-center tracking-widest"
                    />
                  </div>

                  <div className="flex gap-3">
                    <button className="flex-1 bg-brand-bg hover:bg-brand-secondary/50 border border-brand-glass-border text-brand-text font-bold py-3 rounded-xl transition-colors" onClick={() => setIsCustomDeleteModalOpen(false)}>Cancel</button>
                    <button
                      disabled={isCustomDeleting || !Object.values(customDeleteSections).some(Boolean)}
                      className="flex-[2] bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-red-500/20 flex items-center justify-center gap-2"
                      onClick={handleCustomDelete}
                    >
                      {isCustomDeleting ? 'Deleting...' : 'Yes, Delete Selected'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
          {isPaymentModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsPaymentModalOpen(false)}></motion.div>
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 10 }} 
                animate={{ opacity: 1, scale: 1, y: 0 }} 
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-brand-card rounded-3xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden z-10 relative border border-brand-glass-border"
              >
                <div className="p-8 flex flex-col items-center text-center">
                  <div className="w-48 h-48 bg-white p-2 rounded-2xl mb-6 shadow-xl shadow-brand-primary/10">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=upi://pay?pa=cielocafe@upi&pn=CieloCafe&am=6500.00&cu=INR" alt="QR Code" className="w-full h-full object-cover rounded-xl" />
                  </div>
                  <h3 className="text-xl font-black text-brand-text mb-1">Scan to Pay</h3>
                  <p className="text-brand-text/50 font-medium mb-6">Pay ₹6,500 to renew your Premium Plan for 1 year via any UPI app.</p>
                  
                  <button
                    onClick={() => {
                      setIsPaymentModalOpen(false);
                      toast.success("Thanks! We'll confirm your payment and activate your renewal shortly.", { duration: 6000 });
                    }}
                    className="w-full py-4 text-sm font-bold text-white bg-brand-primary hover:opacity-90 rounded-xl shadow-lg shadow-brand-primary/20 transition-all mb-3"
                  >
                    I have made the payment
                  </button>
                  <button onClick={() => setIsPaymentModalOpen(false)} className="w-full py-3 text-sm font-bold text-brand-text/50 hover:text-brand-text transition-colors">
                    Cancel
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {isInvoiceModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsInvoiceModalOpen(false)}></motion.div>
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 10 }} 
                animate={{ opacity: 1, scale: 1, y: 0 }} 
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-brand-card rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden z-10 relative border border-brand-glass-border"
              >
                <div className="flex justify-between items-center p-5 border-b border-brand-glass-border bg-brand-bg/50">
                  <h2 className="text-lg font-black text-brand-text flex items-center gap-2">
                    <Receipt size={20} className="text-brand-primary" />
                    Billing History
                  </h2>
                  <button className="text-brand-text/50 hover:text-brand-text hover:bg-brand-secondary/50 p-1.5 rounded-lg transition-colors" onClick={() => setIsInvoiceModalOpen(false)}>
                    <X size={20} />
                  </button>
                </div>
                <div className="p-6 h-[300px] overflow-y-auto no-scrollbar">
                  {/* No invoice-history table exists yet — showing a fabricated entry here
                      would misrepresent real billing records, so this is left honestly empty
                      until real invoice tracking is built. */}
                  <div className="h-full flex flex-col items-center justify-center text-center text-brand-text/50">
                    <Receipt size={32} className="mb-3 opacity-30" />
                    <p className="font-bold text-brand-text/70 mb-1">No billing history yet</p>
                    <p className="text-xs max-w-[240px]">Renewal payments are verified manually — contact support for past payment records.</p>
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
