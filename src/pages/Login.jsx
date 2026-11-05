import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { ChefHat, Lock, Mail, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { getDeviceId, getDeviceName, registerDeviceSession, consumeSkipNextAutoLogin } from '../lib/session';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isAutoLoggingIn, setIsAutoLoggingIn] = useState(false);
  // Drives the "Switch account" link — only worth showing if there's actually something
  // saved to clear.
  const [hasSavedCredentials, setHasSavedCredentials] = useState(false);
  // Guards against an overlapping retry (e.g. the 'online' listener firing while an
  // attempt from mount is still in flight) — not a "run only once" gate, since the
  // online-retry below is expected to fire the auto-login again after the first try.
  const isAttemptingAutoLogin = useRef(false);

  // Auto-fill and auto-submit with any saved credentials, on mount and again whenever
  // connectivity returns. The retry-on-'online' matters because a network drop mid-session
  // signs the user out (see App.jsx's SIGNED_OUT handling) and remounts this screen — the
  // mount attempt below fires immediately and, if still offline, fails right away. Without
  // the retry, a cashier would be stuck on a manual login screen mid-service until someone
  // notices and clicks Login again by hand.
  useEffect(() => {
    let cancelled = false;

    const tryAutoLogin = async () => {
      if (isAttemptingAutoLogin.current || !window.electronAPI?.loadCredentials) return;
      isAttemptingAutoLogin.current = true;
      try {
        const saved = await window.electronAPI.loadCredentials();
        if (!saved || cancelled) return;
        setHasSavedCredentials(true);

        // Set right after a MANUAL or REMOTE sign-out (App.jsx) — a human deliberately
        // ended the session and needs an actual blank form to switch accounts into, not
        // an instant silent re-login as the same one. Consumed (cleared) here so it only
        // skips this one attempt; a later 'online' retry in this same mount behaves
        // normally again.
        if (consumeSkipNextAutoLogin()) return;

        setEmail(saved.email);
        setPassword(saved.password);
        setIsAutoLoggingIn(true);
        await performLogin(saved.email, saved.password);
      } finally {
        if (!cancelled) setIsAutoLoggingIn(false);
        isAttemptingAutoLogin.current = false;
      }
    };

    tryAutoLogin();
    window.addEventListener('online', tryAutoLogin);
    return () => {
      cancelled = true;
      window.removeEventListener('online', tryAutoLogin);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const performLogin = async (loginEmail, loginPassword) => {
    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });

      if (error) {
        throw error;
      }

      const userId = data.user.id;
      const deviceId = await getDeviceId();

      // "Remember me" — password is encrypted at rest via Electron's safeStorage (see main.js),
      // never stored in plaintext or localStorage.
      if (window.electronAPI?.saveCredentials) {
        if (rememberMe) {
          await window.electronAPI.saveCredentials(loginEmail, loginPassword);
        } else {
          await window.electronAPI.clearCredentials();
        }
      }

      // Enforces the 5-device cap, auto-evicting the account's stalest session if this is
      // a new device claiming a slot that's already full — see lib/session.js. Previously
      // this blocked the login outright ("Maximum 5 devices allowed"), which permanently
      // locked an account out once 5 device_ids existed, dead or not.
      const { status, evicted } = await registerDeviceSession(userId, deviceId, getDeviceName());
      if (status === 'evicted') {
        toast.success(`Signed in — freed up the device slot used by "${evicted.device_name || 'an inactive device'}".`, { duration: 7000 });
      } else {
        toast.success('Successfully logged in!');
      }
    } catch (error) {
      toast.error(error.message || 'Failed to login');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    performLogin(email, password);
  };

  // Persistent escape hatch, independent of the in-memory skip-next-auto-login flag —
  // that flag doesn't survive the whole Electron process being closed and reopened between
  // a logout and the next login, so this covers that gap directly instead of relying on
  // timing.
  const handleSwitchAccount = async () => {
    await window.electronAPI?.clearCredentials?.();
    setHasSavedCredentials(false);
    setEmail('');
    setPassword('');
    toast.success('Saved login cleared — enter different details.');
  };

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-brand-card border border-brand-glass-border rounded-3xl p-8 shadow-2xl relative overflow-hidden">
          
          {/* Decorative background blur */}
          <div className="absolute -top-20 -right-20 w-40 h-40 bg-brand-primary/20 rounded-full blur-3xl"></div>
          <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-brand-secondary/20 rounded-full blur-3xl"></div>
          
          <div className="relative z-10 flex flex-col items-center mb-8">
            <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center shadow-lg mb-4 overflow-hidden">
              <img src="./logo.png" alt="DineOvo Logo" className="w-full h-full object-contain p-2" />
            </div>
            <h1 className="text-2xl font-black text-brand-text">DINEOVO POS</h1>
            <p className="text-brand-text/50 font-medium text-sm tracking-wide mt-1 uppercase">Welcome Back</p>
          </div>

          <form onSubmit={handleLogin} className="relative z-10 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-brand-text/50 uppercase tracking-widest pl-1">Email Address</label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-text/40">
                  <Mail size={18} />
                </div>
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@dineovo.com"
                  required
                  className="w-full bg-brand-secondary/30 border border-brand-glass-border rounded-xl pl-11 pr-4 py-3.5 text-brand-text text-sm focus:outline-none focus:border-brand-primary/50 transition-colors"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-brand-text/50 uppercase tracking-widest pl-1">Password</label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-text/40">
                  <Lock size={18} />
                </div>
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full bg-brand-secondary/30 border border-brand-glass-border rounded-xl pl-11 pr-4 py-3.5 text-brand-text text-sm focus:outline-none focus:border-brand-primary/50 transition-colors"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pl-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded text-brand-primary bg-brand-secondary/30 border-brand-glass-border focus:ring-brand-primary"
                />
                <span className="text-xs font-medium text-brand-text/60">Remember me on this device</span>
              </label>
              {hasSavedCredentials && (
                <button
                  type="button"
                  onClick={handleSwitchAccount}
                  className="text-xs font-bold text-brand-primary hover:underline"
                >
                  Switch account
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="mt-4 w-full bg-brand-primary text-white font-bold rounded-xl py-4 flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors shadow-lg disabled:opacity-70 disabled:cursor-not-allowed group"
            >
              {isAutoLoggingIn ? 'Signing you in...' : isLoading ? 'Authenticating...' : 'Sign In'}
              {!isLoading && <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />}
            </button>
          </form>

        </div>
        
        <div className="text-center mt-6 text-brand-text/40 text-xs font-medium">
          DineOvo Offline POS System v1.0
        </div>
      </motion.div>
    </div>
  );
}

export default Login;
