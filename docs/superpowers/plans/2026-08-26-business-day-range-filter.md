# Business-Day Calendar Range Filter — Implementation Plan

**Goal:** Replace fixed Today/7d/30d presets with a shared date-range control (presets + calendar) across all five money screens, with correct IST business-day boundaries.

**Architecture:** One pure, tested date module (`src/lib/businessDay.js`) defines what "a day" means; one shared `<DateRangePicker>` renders it; every page consumes both. Same single-definition approach that fixed the revenue drift — no page computes its own dates.

## Decisions (from the user)

- **Business day = 05:00 IST → 04:59:59 IST next day.** An order at 00:45 on 26 Aug belongs to the **25 Aug** business day, matching how the till is counted at closing.
- **Scope: all five pages** — Analytics, Dashboard, Revenue, Reports **and** the KDS Orders page. KDS keeps its quick tabs as presets so service speed is unaffected.
- **Notification sounds: deferred** until the sound files arrive.

## Global constraints

- **No new npm dependencies.** Calendar UI uses native `<input type="date">`, which renders a real calendar popup in Chromium/Electron and is touch-friendly. A custom range-calendar can replace it later without changing the data layer.
- IST is fixed at UTC+5:30 (India does not observe DST), so a fixed offset is correct and avoids pulling in a timezone library.
- Existing revenue definitions (`orderRevenue`, `isRevenueOrder`) must not change.
- Range is capped (default 366 days) so a calendar cannot trigger an unbounded fetch.

## Known risks being handled

| Risk | Mitigation |
|---|---|
| UTC vs IST day boundary | All range math in `businessDay.js`, unit-tested against the 00:45 / 06:00 cases |
| `Revenue.jsx` fetches the **entire** orders table today (no filter at all) | Gets a bounded range like every other page |
| No index on `orders.created_at` — every range query is a seq scan | Migration adds one |
| Silent truncation on a large range returning partial data → wrong totals | Fetch asserts row count against an exact `count` query and surfaces a visible error rather than a wrong number |
| Pages drifting apart again | One shared component + one shared module |

## Tasks

### Task 1: `src/lib/businessDay.js` + tests
Pure functions: `businessDayStartUtc(dateStr)`, `businessDayRangeUtc(fromStr, toStr)`, `businessDayOf(timestamp)`, `presetRange(key)`, `MAX_RANGE_DAYS`.
Tests cover: 5 AM cutoff both sides, the 00:45→previous-day case, 06:00→same-day case, range end being exclusive, preset correctness, and max-range clamping.

### Task 2: `database_scripts/2026-08-26_orders_created_at_index.sql`
`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_created_at ON public.orders (created_at DESC);`
Plus the same on `expenses(date)` since Dashboard/Reports filter on it.

### Task 3: `src/components/DateRangePicker.jsx`
Presets (Today / Yesterday / Last 7 / Last 30 / This month / Custom) + two native date inputs. Emits `{ fromUtc, toUtc, label }`. Clamps to `MAX_RANGE_DAYS` with a visible message.

### Task 4: Wire Analytics, Dashboard, Revenue, Reports
Each replaces its own date state with the shared picker and fetches `.gte('created_at', fromUtc).lt('created_at', toUtc)`. Trend/day grouping switches from `format(parseISO(...))` to `businessDayOf(...)`.

### Task 5: Wire the KDS Orders page
Keep Today/Yesterday/Week tabs; add a Custom range option. Client-side filter uses `businessDayOf`, replacing the current `setHours(0,0,0,0)` logic which is midnight-based and inconsistent with the rest.

### Task 6: Verify
`npm test`, `npm run build`, no-undef lint check, and a manual cross-check that all four money pages report the same total for the same custom range.
