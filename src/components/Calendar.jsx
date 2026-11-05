import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// A two-month range calendar, built rather than pulled in as a dependency so it inherits
// the app's brand-* theme (and its light/dark data-theme switching) exactly, and so the
// installer doesn't grow for one screen.
//
// All date arithmetic goes through Date.UTC and 'YYYY-MM-DD' strings. Using local Date
// methods here would reintroduce exactly the timezone drift that src/lib/businessDay.js
// exists to prevent — a calendar cell must mean the same day regardless of where the
// machine thinks it is.

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
/** m is 1-based. Day 0 of the next month is the last day of this one. */
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const firstWeekday = (y, m) => new Date(Date.UTC(y, m - 1, 1)).getUTCDay();

function addMonths(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

function MonthGrid({ ym, from, to, hover, pendingFrom, maxDate, onPick, onHover }) {
  const [y, m] = ym.split('-').map(Number);
  const total = daysInMonth(y, m);
  const lead = firstWeekday(y, m);

  // While picking the second date, preview the span under the cursor.
  //
  // The first click MUST highlight on its own, without waiting for a hover: a POS runs on
  // a touch screen where there is no hover at all, so the previous version made the first
  // tap look like it had done nothing — which is why selecting a single day appeared
  // impossible. Tapping the same day twice selects just that day.
  const previewFrom = pendingFrom
    ? (hover && hover < pendingFrom ? hover : pendingFrom)
    : from;
  const previewTo = pendingFrom
    ? (hover ? (hover < pendingFrom ? pendingFrom : hover) : pendingFrom)
    : to;

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(<div key={`lead-${i}`} />);

  for (let d = 1; d <= total; d++) {
    const day = ymd(y, m, d);
    const disabled = maxDate && day > maxDate;
    const isStart = day === previewFrom;
    const isEnd = day === previewTo;
    const inRange = previewFrom && previewTo && day > previewFrom && day < previewTo;
    const isEdge = isStart || isEnd;

    cells.push(
      <button
        key={day}
        type="button"
        disabled={disabled}
        aria-label={day}
        aria-current={isEdge ? 'date' : undefined}
        onClick={() => onPick(day)}
        onMouseEnter={() => onHover(day)}
        className={[
          'h-9 w-full text-xs font-bold transition-colors relative',
          disabled ? 'text-brand-text/20 cursor-not-allowed' : 'cursor-pointer',
          inRange ? 'bg-brand-primary/15 text-brand-text' : '',
          isEdge ? 'bg-brand-primary text-white' : '',
          !inRange && !isEdge && !disabled ? 'text-brand-text/80 hover:bg-brand-secondary/40' : '',
          isStart ? 'rounded-l-lg' : '',
          isEnd ? 'rounded-r-lg' : '',
          !isEdge && inRange ? 'rounded-none' : '',
          !isEdge && !inRange ? 'rounded-lg' : '',
        ].join(' ')}
      >
        {d}
      </button>
    );
  }

  return (
    <div className="min-w-[15rem]">
      <div className="text-center text-xs font-black text-brand-text mb-2">
        {MONTHS[m - 1]} {y}
      </div>
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map(w => (
          <div key={w} className="h-6 flex items-center justify-center text-[10px] font-bold text-brand-text/40">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">{cells}</div>
    </div>
  );
}

export default function Calendar({ from, to, maxDate, onSelect }) {
  // Open on the month already selected, else the latest selectable month, else this one.
  const [viewMonth, setViewMonth] = useState(() => {
    const seed = from || maxDate;
    if (seed) return seed.slice(0, 7);
    const now = new Date();
    return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
  });
  const [pendingFrom, setPendingFrom] = useState(null);
  const [hover, setHover] = useState(null);

  const pick = (day) => {
    if (!pendingFrom) {
      // First click starts a new range.
      setPendingFrom(day);
      setHover(day);
      return;
    }
    // Second click closes it. Picking backwards is allowed and simply reverses the range
    // rather than being rejected.
    const a = day < pendingFrom ? day : pendingFrom;
    const b = day < pendingFrom ? pendingFrom : day;
    setPendingFrom(null);
    setHover(null);
    onSelect(a, b);
  };

  return (
    <div onMouseLeave={() => setHover(null)}>
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setViewMonth(addMonths(viewMonth, -1))}
          className="p-1.5 rounded-lg text-brand-text/60 hover:bg-brand-secondary/40 hover:text-brand-text transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-[11px] font-bold text-brand-text/50">
          {pendingFrom
            ? `From ${pendingFrom} — tap it again for one day, or pick the end date`
            : 'Pick a start date'}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setViewMonth(addMonths(viewMonth, 1))}
          className="p-1.5 rounded-lg text-brand-text/60 hover:bg-brand-secondary/40 hover:text-brand-text transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-5">
        <MonthGrid
          ym={viewMonth}
          from={from} to={to} hover={hover} pendingFrom={pendingFrom} maxDate={maxDate}
          onPick={pick} onHover={setHover}
        />
        <MonthGrid
          ym={addMonths(viewMonth, 1)}
          from={from} to={to} hover={hover} pendingFrom={pendingFrom} maxDate={maxDate}
          onPick={pick} onHover={setHover}
        />
      </div>
    </div>
  );
}
