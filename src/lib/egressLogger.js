/**
 * Dev-only / debug logger for monitoring Supabase egress.
 * Enabled when import.meta.env.DEV is true or localStorage.getItem('dineovo_debug_egress') === 'true'.
 */

let bytesThisMinute = 0;
let lastMinuteReset = Date.now();

export function logSupabaseRead(table, action, data) {
  const isEnabled = import.meta.env.DEV || (typeof window !== 'undefined' && window.localStorage?.getItem('dineovo_debug_egress') === 'true');
  if (!isEnabled) return;

  const now = Date.now();
  if (now - lastMinuteReset > 60000) {
    bytesThisMinute = 0;
    lastMinuteReset = now;
  }

  const approxBytes = data ? JSON.stringify(data).length : 0;
  bytesThisMinute += approxBytes;
  const kb = (approxBytes / 1024).toFixed(2);
  const totalKb = (bytesThisMinute / 1024).toFixed(2);

  console.log(`[Egress Monitor] ${table} (${action}): ~${kb} KB | Last min: ~${totalKb} KB`);
}
