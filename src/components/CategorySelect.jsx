import { useState } from 'react';

// Dropdown of existing categories with a "+ Add New Category" escape hatch into free text.
export default function CategorySelect({ categories, value, onChange, required = false }) {
  const [manualEntry, setManualEntry] = useState(() => !!value && !categories.includes(value));

  if (manualEntry) {
    return (
      <div className="flex gap-2">
        <input
          type="text"
          autoFocus
          placeholder="New category name"
          className="w-full bg-brand-card border border-brand-glass-border rounded-xl px-4 py-3 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 text-brand-text font-medium transition-all shadow-sm"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        {categories.length > 0 && (
          <button
            type="button"
            title="Choose an existing category"
            onClick={() => { setManualEntry(false); onChange(''); }}
            className="shrink-0 px-3 rounded-xl border border-brand-glass-border text-xs font-bold text-brand-text/60 hover:text-brand-text hover:bg-brand-secondary/30 transition-colors"
          >
            List
          </button>
        )}
      </div>
    );
  }

  return (
    <select
      value={value}
      required={required}
      onChange={e => {
        if (e.target.value === '__new__') { setManualEntry(true); onChange(''); }
        else onChange(e.target.value);
      }}
      className="w-full bg-brand-card border border-brand-glass-border rounded-xl px-4 py-3 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 text-brand-text font-medium transition-all shadow-sm appearance-none"
    >
      <option value="" disabled>Select category{required ? '' : ' (optional)'}</option>
      {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
      <option value="__new__">+ Add New Category</option>
    </select>
  );
}
