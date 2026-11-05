import { supabase } from './supabase';

// Why the sign-out that's about to happen was initiated.
//
// Supabase only tells us that a SIGNED_OUT event occurred, never why — a deliberate
// logout, a remote force-logout and a token refresh that failed offline all look
// identical. Recording the cause immediately before calling signOut() lets the UI
// report the real reason instead of guessing.
//
// This lives at module scope rather than in a React ref because the sign-out paths
// are spread across components that can't share a ref: App's sidebar button, App's
// remote-logout listener, and Login's device-cap check.
//
// The previous implementation used a boolean ref that was reset on EVERY auth event
// (including TOKEN_REFRESHED), so a refresh landing between "flag set" and the
// SIGNED_OUT delivery made a deliberate logout look unexpected. This is only cleared
// when a SIGNED_OUT is actually consumed.
let pendingSignOutReason = null;

export const SIGN_OUT_MANUAL = 'manual';
export const SIGN_OUT_REMOTE = 'remote';

// Record why a sign-out is happening, without performing it. Use this when the
// caller has extra work to do first (e.g. deleting the active_sessions row) and
// needs the reason registered before that work triggers side effects.
export function markSignOutReason(reason) {
  pendingSignOutReason = reason;
}

// True while a locally-initiated sign-out is in flight. Lets listeners ignore
// side effects caused by our own logout — notably the Realtime DELETE echo of the
// session row we just deleted ourselves.
export function isSignOutPending() {
  return pendingSignOutReason !== null;
}

// Returns why the sign-out that just landed happened, or null if nothing local
// initiated it — meaning the session died on its own (failed token refresh,
// revoked credentials) and the user genuinely needs telling.
export function consumePendingSignOutReason() {
  const reason = pendingSignOutReason;
  pendingSignOutReason = null;
  return reason;
}

// Mark the reason and sign out in one step.
export async function signOutWithReason(reason) {
  markSignOutReason(reason);
  const { error } = await supabase.auth.signOut();
  if (error) {
    // Never leave a stale reason behind to mislabel a later, unrelated sign-out.
    pendingSignOutReason = null;
    throw error;
  }
}

// Whether the login screen's auto-login (saved "remember me" credentials) should skip its
// next attempt. Set by App.jsx right after a SIGNED_OUT it can attribute to a MANUAL or
// REMOTE sign-out — both mean a human deliberately ended this session and needs an actual
// blank form to type different credentials into, not an instant silent re-login as the same
// account. A genuinely unexpected drop (reason null — failed token refresh, e.g. offline)
// does NOT set this, since that case should keep auto-retrying once connectivity returns.
//
// In-memory only, so it covers the same-running-app case (the overwhelmingly common one —
// cashier A logs out, cashier B logs in, all within one launch of the app). It does not
// survive the whole Electron process being closed and reopened between those two steps;
// Login's "Switch account" link is the persistent fallback for that edge case.
let skipNextAutoLogin = false;

export function markSkipNextAutoLogin() {
  skipNextAutoLogin = true;
}

export function consumeSkipNextAutoLogin() {
  const skip = skipNextAutoLogin;
  skipNextAutoLogin = false;
  return skip;
}

// ─── Device identity ───
//
// In Electron this is persisted in the userData directory (see main.js) so it survives
// reinstalls and "clear app data" — previously it lived only in localStorage, which meant
// every reinstall minted a fresh identity and orphaned the old active_sessions row forever,
// eventually eating all 5 of the account's device slots with dead entries for the same
// physical machine. In a browser (no Electron) it falls back to localStorage, since
// there's no main-process file system to persist against.
let cachedDeviceId = null;

export async function getDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;

  const existing = localStorage.getItem('dineovo_device_id');

  if (window.electronAPI?.getDeviceId) {
    try {
      const id = await window.electronAPI.getDeviceId(existing);
      // Keep a synced cache for any code path that still reads localStorage directly.
      localStorage.setItem('dineovo_device_id', id);
      cachedDeviceId = id;
      return id;
    } catch (err) {
      console.error('Failed to get persistent device id, falling back to localStorage:', err);
    }
  }

  const id = existing || crypto.randomUUID();
  localStorage.setItem('dineovo_device_id', id);
  cachedDeviceId = id;
  return id;
}

export function getDeviceName() {
  const ua = navigator.userAgent;
  const isElectron = ua.includes('Electron');
  if (ua.includes('Windows')) return isElectron ? 'Windows POS' : 'Windows Browser';
  if (ua.includes('Mac')) return isElectron ? 'Mac POS' : 'Mac Browser';
  if (ua.includes('iPad')) return 'iPad POS';
  if (ua.includes('Android')) return 'Android Device';
  if (ua.includes('iPhone')) return 'iPhone';
  return isElectron ? 'DineOvo Desktop App' : 'Unknown Device';
}

// ─── Device session cap ───
//
// `active_sessions.device_id` is globally UNIQUE (one row per physical device, whichever
// account is currently signed in there) — so a device switching accounts has to reassign
// its existing row, not insert a second one.
export const MAX_SESSIONS = 5;

// Registers (or refreshes, or reassigns) this device's session row for `userId`, enforcing
// the 5-device cap by auto-evicting the account's stalest session when a genuinely new
// device claims a slot that's already full. Auto-eviction (rather than blocking the login)
// was a deliberate choice: a POS that permanently locks itself out after a few reinstalls
// is a worse failure mode than occasionally freeing up an inactive device automatically.
//
// ponytail: the read-then-write here isn't atomic, so two devices registering in the same
// instant could both see room and both insert, briefly exceeding MAX_SESSIONS by one. Not
// worth a Postgres RPC for a single-cafe, low-concurrency login flow — upgrade path if this
// ever matters is a `FOR UPDATE`-guarded stored procedure.
export async function registerDeviceSession(userId, deviceId, deviceName) {
  const { data: existingRow, error: lookupErr } = await supabase
    .from('active_sessions')
    .select('id, user_id')
    .eq('device_id', deviceId)
    .maybeSingle();
  if (lookupErr) throw lookupErr;

  if (existingRow && existingRow.user_id === userId) {
    // Same device, same account — a heartbeat/refresh, not a new slot.
    const { error } = await supabase
      .from('active_sessions')
      .update({ last_active: new Date().toISOString() })
      .eq('id', existingRow.id);
    if (error) throw error;
    return { status: 'existing' };
  }

  // Either a brand-new device, or this physical device is switching to a different
  // account — both need this user's cap checked before claiming/reassigning a slot.
  const { data: sessions, error: sessErr } = await supabase
    .from('active_sessions')
    .select('id, device_name, last_active')
    .eq('user_id', userId);
  if (sessErr) throw sessErr;

  let evicted = null;
  if (sessions && sessions.length >= MAX_SESSIONS) {
    const stalest = [...sessions].sort((a, b) => new Date(a.last_active) - new Date(b.last_active))[0];
    const { error } = await supabase.from('active_sessions').delete().eq('id', stalest.id);
    if (error) throw error;
    evicted = stalest;
  }

  const row = { user_id: userId, device_id: deviceId, device_name: deviceName, last_active: new Date().toISOString() };
  if (existingRow) {
    const { error } = await supabase.from('active_sessions').update(row).eq('id', existingRow.id);
    if (error) throw error;
  } else {
    // upsert, not insert: two logins for the same device_id can race past the
    // existingRow lookup above (e.g. auto-login-on-mount vs. a manual submit),
    // and a plain insert then crashes on the unique constraint instead of just
    // reassigning the row like the existingRow branch above already does.
    const { error } = await supabase.from('active_sessions').upsert(row, { onConflict: 'device_id' });
    if (error) throw error;
  }

  return { status: evicted ? 'evicted' : (existingRow ? 'reassigned' : 'inserted'), evicted };
}
