// What "a day" means for this cafe — the single definition every screen filters by.
//
// A business day runs 05:00 IST to 04:59:59 IST the following morning, so an order
// served at 00:45 counts against the night it was actually served, matching how the
// till is counted at closing. Without this, a calendar filter would split a single
// night's trade across two dates and disagree with the owner's own cash count.
//
// The old filters were rolling windows (`subDays(now, 30)`), which never touched a day
// boundary at all. Introducing calendar dates is what makes this math necessary:
// created_at is stored as UTC, and a naive `>= '2026-08-25'` would mean UTC midnight,
// i.e. 05:30 IST — silently misfiling every order from the small hours.
//
// India has no DST, so a fixed +05:30 offset is exact and avoids a timezone dependency.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Hour (IST) at which one business day rolls into the next. */
export const BUSINESS_DAY_START_HOUR = 5;

/** Upper bound on a single query's span, so a calendar can't trigger an unbounded fetch. */
export const MAX_RANGE_DAYS = 366;

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for a Date, read in IST. */
function toDateStr(date) {
  const d = new Date(date.getTime() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The UTC instant at which the given business day (a 'YYYY-MM-DD' string) begins. */
export function businessDayStartUtc(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  // The IST wall-clock moment `dateStr 05:00`, expressed in UTC.
  return new Date(Date.UTC(y, m - 1, d, BUSINESS_DAY_START_HOUR, 0, 0, 0) - IST_OFFSET_MS);
}

/** Which business day a timestamp belongs to, as 'YYYY-MM-DD'. */
export function businessDayOf(timestamp) {
  const t = new Date(timestamp).getTime();
  // Shift onto the IST wall clock, then roll back the cutoff so 00:00–04:59 lands on
  // the previous day.
  return toDateStr(new Date(t - BUSINESS_DAY_START_HOUR * 60 * 60 * 1000));
}

/** Today's business day, as 'YYYY-MM-DD'. */
export function todayBusinessDay() {
  return businessDayOf(new Date());
}

/** Shift a 'YYYY-MM-DD' by whole days. */
export function addDays(dateStr, delta) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * DAY_MS;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function daysBetween(fromStr, toStr) {
  return Math.round((Date.parse(toStr) - Date.parse(fromStr)) / DAY_MS);
}

/**
 * Keep a range inside MAX_RANGE_DAYS by moving the start forward, and put the dates in
 * order if they were picked backwards. Returns `clamped` so the UI can say so out loud
 * rather than quietly showing a different period than the one selected.
 */
export function clampRange(fromStr, toStr) {
  let from = fromStr;
  let to = toStr;
  if (Date.parse(from) > Date.parse(to)) [from, to] = [to, from];

  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    return { from: addDays(to, -MAX_RANGE_DAYS), to, clamped: true };
  }
  return { from, to, clamped: false };
}

/**
 * UTC bounds for a run of business days. `toUtc` is EXCLUSIVE — it is the instant the
 * following business day begins — so queries use `.gte(fromUtc).lt(toUtc)` and no order
 * is double-counted at a boundary.
 */
export function businessDayRangeUtc(fromStr, toStr) {
  const { from, to, clamped } = clampRange(fromStr, toStr);
  return {
    from,
    to,
    clamped,
    fromUtc: businessDayStartUtc(from).toISOString(),
    toUtc: businessDayStartUtc(addDays(to, 1)).toISOString(),
  };
}

/** Named quick ranges, so every page offers the same shortcuts. */
export function presetRange(key) {
  const today = todayBusinessDay();
  switch (key) {
    case 'today':      return { key, label: 'Today',        ...businessDayRangeUtc(today, today) };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { key, label: 'Yesterday', ...businessDayRangeUtc(y, y) };
    }
    case 'last7':      return { key, label: 'Last 7 Days',  ...businessDayRangeUtc(addDays(today, -6), today) };
    case 'last30':     return { key, label: 'Last 30 Days', ...businessDayRangeUtc(addDays(today, -29), today) };
    case 'last90':     return { key, label: 'Last 90 Days', ...businessDayRangeUtc(addDays(today, -89), today) };
    case 'thisMonth':  return { key, label: 'This Month',   ...businessDayRangeUtc(`${today.slice(0, 7)}-01`, today) };
    default:           return { key: 'last30', label: 'Last 30 Days', ...businessDayRangeUtc(addDays(today, -29), today) };
  }
}

/** Every business day in a range, oldest first — for building trend-chart buckets. */
export function eachBusinessDay(fromStr, toStr) {
  const out = [];
  for (let d = fromStr; Date.parse(d) <= Date.parse(toStr); d = addDays(d, 1)) out.push(d);
  return out;
}
