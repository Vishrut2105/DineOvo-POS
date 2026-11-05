// The GST rate used to be read straight from localStorage.print_settings, which is only
// written when someone opens the Settings page. On a fresh install (or after cleared app
// data) the key was simply absent, `parseFloat(undefined) || 0` produced 0, and every bill
// silently went out with no GST — the CGST/SGST lines vanished entirely, because they sit
// behind a `taxRatePercent > 0` guard. Loading settings at startup removes that cause;
// getTaxRatePercent() returning null lets the caller refuse to bill rather than guess.
import { supabase } from './supabase';

const CACHE_KEY = 'print_settings';

export function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

/** Fetch app_settings into the localStorage cache. Call once at startup. */
export async function loadAppSettings() {
  const { data, error } = await supabase.from('app_settings').select('key, value');
  if (error || !data) return readCache();

  const merged = { ...readCache() };
  for (const { key, value } of data) merged[key] = value;
  localStorage.setItem(CACHE_KEY, JSON.stringify(merged));
  return merged;
}

/**
 * The configured GST percentage, or null if it could not be determined.
 * null is NOT the same as 0 — 0 is a valid zero-rated configuration, while null means we
 * do not know the rate and must not issue a bill.
 */
export function getTaxRatePercent() {
  const raw = readCache().tax_rate;
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
