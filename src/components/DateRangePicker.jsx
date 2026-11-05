import React, { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, AlertTriangle, X } from 'lucide-react';
import Calendar from './Calendar';
import {
  presetRange, businessDayRangeUtc, todayBusinessDay,
  MAX_RANGE_DAYS, BUSINESS_DAY_START_HOUR,
} from '../lib/businessDay';

// One date control for every money screen. Pages used to each hold their own
// today/7d/30d state, which is how they drifted apart; now they all consume the same
// range object and the same definition of a day (see src/lib/businessDay.js).
//
// Pages only ever read fromUtc/toUtc, so the UI here can change freely without touching
// any query.

const PRESETS = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7',     label: 'Last 7 Days' },
  { key: 'last30',    label: 'Last 30 Days' },
  { key: 'thisMonth', label: 'This Month' },
];

export const DEFAULT_RANGE = presetRange('last30');

// `clearTo` is the preset "Clear filter" falls back to — the page's normal default rather
// than an empty state, since every one of these screens must always show *some* period.
export default function DateRangePicker({
  value, onChange, presets = PRESETS, className = '', clearTo = 'last30',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef(null);

  // Close on an outside click or Escape — a calendar left hanging open over a POS screen
  // is worse than no calendar.
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setIsOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setIsOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  const applyPreset = (key) => {
    setIsOpen(false);
    onChange(presetRange(key));
  };

  const applyCustom = (from, to) => {
    const range = businessDayRangeUtc(from, to);
    onChange({ key: 'custom', label: from === to ? from : `${from} → ${to}`, ...range });
    setIsOpen(false);
  };

  const isCustom = value?.key === 'custom';

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {presets.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => applyPreset(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
              value?.key === key
                ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/30'
                : 'bg-transparent text-brand-text/50 border-brand-glass-border hover:bg-brand-secondary/20'
            }`}
          >
            {label}
          </button>
        ))}

        <div className="relative" ref={popoverRef}>
          <button
            onClick={() => setIsOpen(o => !o)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 ${
              isCustom
                ? 'bg-brand-primary/10 text-brand-primary border-brand-primary/30'
                : 'bg-transparent text-brand-text/50 border-brand-glass-border hover:bg-brand-secondary/20'
            }`}
          >
            <CalendarIcon size={12} />
            {isCustom ? value.label : 'Custom'}
          </button>

          {isOpen && (
            <div className="absolute right-0 top-full mt-2 z-50 bg-brand-card border border-brand-glass-border rounded-2xl shadow-2xl p-4 animate-slide-up">
              <div className="flex items-start justify-between mb-3 gap-6">
                <div>
                  <div className="text-sm font-black text-brand-text">Select a date range</div>
                  <div className="text-[10px] font-medium text-brand-text/40 mt-0.5">
                    A day runs {BUSINESS_DAY_START_HOUR}:00 AM to {BUSINESS_DAY_START_HOUR}:00 AM, so
                    late-night orders count toward the night they were served.
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  aria-label="Close calendar"
                  className="text-brand-text/40 hover:text-brand-text shrink-0"
                >
                  <X size={16} />
                </button>
              </div>

              <Calendar
                from={value?.from}
                to={value?.to}
                maxDate={todayBusinessDay()}
                onSelect={applyCustom}
              />

              <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-brand-glass-border">
                <button
                  onClick={() => applyPreset(clearTo)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-brand-text/60 border border-brand-glass-border hover:bg-brand-secondary/30 hover:text-brand-text transition-colors"
                >
                  Clear filter
                </button>
                <span className="text-[10px] font-medium text-brand-text/40">
                  {value?.from === value?.to ? value?.from : `${value?.from} → ${value?.to}`}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {value?.clamped && (
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
          <AlertTriangle size={12} />
          Range shortened to the last {MAX_RANGE_DAYS} days — showing {value.from} onwards.
        </div>
      )}
    </div>
  );
}
