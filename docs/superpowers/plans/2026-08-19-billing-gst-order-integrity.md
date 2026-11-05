# Billing, GST & Order Integrity Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every rupee figure the POS shows, prints, collects and reports the same correct number — GST-inclusive, discount-applied, rounded to whole rupees per GST rules — and make order numbers and KDS checkboxes reliable.

**Architecture:** Today the same subtotal/GST/discount math is re-implemented in **25 places across 5 files**, each slightly differently, which is why the screen, the printed bill and the dashboard disagree. This plan collapses all of it into one shared module (`src/lib/orderTotals.js`) that every surface calls, persists the billing breakdown on the order so bills reprint identically, replaces the per-machine order counter with a Postgres sequence, and fixes the KDS checkbox reset.

**Tech Stack:** React 19 + Vite renderer, Supabase (Postgres), Electron, `local-server` (Express + SQLite offline queue). Tests via Node's built-in `node:test` runner (no new dependencies).

**Spec:** This document (audit findings in "Audit" below serve as the spec).

## Global Constraints

- **No new npm dependencies.** Money math uses stdlib only.
- **GST is exclusive** — added on top of menu prices, never baked in. Split evenly CGST + SGST.
- **Grand total is always a whole rupee.** The difference is carried as an explicit `Round Off` line (CGST Act s.170 convention).
- **A discount can never exceed the subtotal** and a percentage can never exceed 100%.
- **Historical orders are not modified.** Fixes apply going forward only (user decision).
- **Order numbers come from Postgres**, never from a per-machine counter (multi-terminal safe by design; user is single-terminal now, more planned).
- **If the GST rate cannot be determined, billing is blocked** with a visible error — never silently bill at 0% (user decision).
- Preserve existing patterns: dual-write to Supabase *and* `local-server` where the codebase already does so.
- `database_scripts/*.sql` are hand-run in the Supabase SQL editor. Every script must be **idempotent and re-runnable**.

---

## Audit — root causes found

| # | Reported as | Actual root cause | Evidence |
|---|---|---|---|
| 1 | "305 printed as 304.5" | `grandTotal` is never rounded. UI renders `.toFixed(0)` → **305**; the printed bill and WhatsApp render `.toFixed(2)` → **304.50**; the amount recorded as collected is the raw `304.50`. Three different numbers for one bill. | `Orders.jsx:1855` (no rounding), `:2140` (`toFixed(0)`), `:1999` + `:1897` (`toFixed(2)`) |
| 2 | "GST not calculated in total" | **CRITICAL, unreported:** the tax rate is read from `localStorage.print_settings`, which is only populated when someone opens the **Settings page**. On a fresh install / after cleared data, `tax_rate` is absent → `parseFloat(undefined) \|\| 0` → **GST silently becomes 0% and the CGST/SGST lines vanish from the bill entirely** (they're behind a `taxRatePercent > 0` guard). Bills go out with no tax. | `Orders.jsx:1850`, `:1390`; `Settings.jsx:171-197` is the only writer |
| 3 | "GST not calculated in total" (reports) | `Dashboard.jsx`, `Revenue.jsx`, `Reports.jsx` all compute revenue as raw `price × quantity` — no GST, no discount, no round-off. Only `Analytics.jsx` was fixed previously. | `Dashboard.jsx:109-119`, `Revenue.jsx:57`, `Reports.jsx:42,89` |
| 4 | "Discount not calculated properly" | The discount exists **only as React state inside `BillModal`** and is never persisted. Consequences: (a) reopening/reprinting a settled bill shows discount 0 and a *higher* total than the customer actually paid; (b) reports can't see it; (c) a flat `₹` discount larger than the bill, or a `%` over 100, produces a **negative taxable value and negative GST**. | `Orders.jsx:1818-1830`, `:1840` |
| 5 | "Check order ID" | Orders created in the POS (`OrderModal.handleSave`) **insert straight into Supabase and never set `order_number`** → `NULL` → the UI falls back to a hash of the UUID (`parseInt(id,16) % 9000 + 1000`), i.e. a random-looking number. Only orders arriving through `local-server` get a real sequential number, from a **per-machine SQLite counter** that would hand out duplicates the moment a second terminal exists. | `Orders.jsx:1482-1489` (no `order_number`), `local-server/db.js:29-40`, `add_order_number.sql` (plain nullable int, no default) |
| 6 | "Checkbox issue in done & pending" | Two causes. (a) `order_items` is fetched with **no ordering**, so ticking an item rewrites its row, Postgres returns it in a new position, and the list visibly re-shuffles under the user. (b) The `local-server` SQLite `order_items` table **has no `prepared` column**, and `App.jsx` uses local rows as the *base set* — so a local refresh overwrites ticked checkboxes back to unticked. | `App.jsx:593` (no `.order()`), `:572-584` (local as base), `local-server/db.js:39-52` (no `prepared`) |

**Cross-cutting:** 25 duplicated total-calculation sites across `Analytics.jsx`, `Dashboard.jsx`, `Orders.jsx`, `Reports.jsx`, `Revenue.jsx`. Patching them individually is what created the drift; this plan routes them all through one module.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/orderTotals.js` (**create**) | The only place money is calculated. Subtotal, discount clamping, CGST/SGST, round-off, and per-order revenue for reports. |
| `src/lib/orderTotals.test.js` (**create**) | `node:test` assertions covering the 304.5 case, discount clamping, and zero-rate. |
| `src/lib/appSettings.js` (**create**) | Loads `app_settings` (incl. `tax_rate`) at startup and caches it; exposes "rate unavailable" distinctly from "rate is 0". |
| `database_scripts/2026-08-19_billing_and_order_number.sql` (**create**) | Idempotent migration: order-number sequence + billing breakdown columns + `prepared` safety. |
| `src/pages/Orders.jsx` (**modify**) | `BillModal` uses the shared module, blocks on missing rate, persists the breakdown, prints rounded totals + Round Off. `OrderCard` gets stable item ordering. |
| `src/App.jsx` (**modify**) | Loads app settings on startup; deterministic `order_items` ordering; preserves `prepared`. |
| `src/pages/{Analytics,Dashboard,Revenue,Reports}.jsx` (**modify**) | Replace inline revenue math with `orderRevenue()`. |
| `local-server/db.js`, `index.js`, `sync.js` (**modify**) | Add `prepared` column + endpoint; stop assigning order numbers locally. |
| `package.json` (**modify**) | Add `test` script. |

---

## Task 1: Database migration — order numbers and billing columns

**Files:**
- Create: `database_scripts/2026-08-19_billing_and_order_number.sql`

**Interfaces:**
- Produces: `orders.order_number` auto-assigned from sequence `orders_order_number_seq`; columns `orders.discount_type`, `discount_value`, `discount_amount`, `taxable_value`, `tax_rate_percent`, `cgst_amount`, `sgst_amount`, `round_off`, `grand_total`; `order_items.prepared`.

- [ ] **Step 1: Write the migration script**

```sql
-- ============================================================================
-- 2026-08-19  Billing integrity + order numbering
-- Safe to re-run. Run in the Supabase SQL editor.
-- ============================================================================

-- ─── 1. Order numbers from a Postgres sequence ───────────────────────────────
-- Previously order_number was a plain nullable int: orders created in the POS UI
-- inserted straight into Supabase without one (NULL -> UI fell back to a hash of the
-- UUID), and only local-server assigned numbers, from a per-machine SQLite counter
-- that would collide the moment a second terminal existed. Postgres is now the single
-- authority: atomic, gap-free enough for ticketing, and correct for N terminals.
CREATE SEQUENCE IF NOT EXISTS public.orders_order_number_seq AS BIGINT START WITH 24 MINVALUE 1;

ALTER TABLE public.orders
  ALTER COLUMN order_number SET DEFAULT nextval('public.orders_order_number_seq');

ALTER SEQUENCE public.orders_order_number_seq OWNED BY public.orders.order_number;

-- Never hand out a number already used, and never restart below 24 (23 orders were
-- taken manually before numbering existed). `false` = the NEXT nextval() returns this value.
SELECT setval(
  'public.orders_order_number_seq',
  GREATEST(24, COALESCE((SELECT MAX(order_number) FROM public.orders), 0) + 1),
  false
);

-- ─── 2. Billing breakdown persisted on the order ─────────────────────────────
-- Without these, a settled bill cannot be reprinted with the same figures (the discount
-- lived only in React state) and reports cannot separate tax from net revenue.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_type    TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_value   NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_amount  NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS taxable_value    NUMERIC(10,2);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_rate_percent NUMERIC(5,2);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cgst_amount      NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS sgst_amount      NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS round_off        NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS grand_total      NUMERIC(10,2);

-- ─── 3. KDS prepared flag (no-op if fix_item_prepared_tracking.sql already ran) ──
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS prepared BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Run it and verify the sequence**

Run in the Supabase SQL editor, then:

```sql
SELECT last_value, is_called FROM public.orders_order_number_seq;
SELECT column_name, column_default FROM information_schema.columns
 WHERE table_name = 'orders' AND column_name = 'order_number';
```

Expected: `column_default` = `nextval('orders_order_number_seq'::regclass)`; `last_value` >= 24.

- [ ] **Step 3: Verify a new order auto-numbers**

```sql
INSERT INTO public.orders (table_no, status) VALUES ('T99', 'pending') RETURNING id, order_number;
-- confirm order_number is >= 24 and NOT NULL, then clean up:
DELETE FROM public.orders WHERE table_no = 'T99';
```

---

## Task 2: The shared money module

**Files:**
- Create: `src/lib/orderTotals.js`
- Test: `src/lib/orderTotals.test.js`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Produces: `round2(n)`, `computeSubtotal(items)`, `computeDiscount(subtotal, discountType, discountValue)`, `computeOrderTotals({items, discountType, discountValue, taxRatePercent})` → `{subtotal, discountAmount, taxableValue, taxRatePercent, cgstAmount, sgstAmount, gstAmount, rawGrandTotal, grandTotal, roundOff}`, `orderRevenue(order, fallbackTaxRatePercent)` → `{gross, net, gst}`.

- [ ] **Step 1: Write the failing test**

```javascript
// src/lib/orderTotals.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOrderTotals, computeDiscount, orderRevenue } from './orderTotals.js';

const items = (...prices) => prices.map((p, i) => ({ id: String(i), price: p, quantity: 1, status: 'active' }));

test('grand total is a whole rupee and round-off balances it', () => {
  // 290.00 + 5% GST = 304.50 -> the exact bug reported: screen said 305, print said 304.50
  const t = computeOrderTotals({ items: items(290), taxRatePercent: 5 });
  assert.equal(t.rawGrandTotal, 304.5);
  assert.equal(t.grandTotal, 305);
  assert.equal(t.roundOff, 0.5);
  assert.equal(t.taxableValue + t.gstAmount + t.roundOff, t.grandTotal);
});

test('cancelled items are excluded from the subtotal', () => {
  const t = computeOrderTotals({
    items: [...items(100), { id: 'x', price: 500, quantity: 1, status: 'cancelled' }],
    taxRatePercent: 0,
  });
  assert.equal(t.subtotal, 100);
});

test('discount never exceeds the subtotal and never goes negative', () => {
  assert.equal(computeDiscount(200, '₹', 999), 200);
  assert.equal(computeDiscount(200, '%', 150), 200);
  assert.equal(computeDiscount(200, '₹', -50), 0);
});

test('a discount larger than the bill cannot produce negative GST', () => {
  const t = computeOrderTotals({ items: items(200), discountType: '₹', discountValue: 999, taxRatePercent: 18 });
  assert.equal(t.taxableValue, 0);
  assert.equal(t.cgstAmount, 0);
  assert.equal(t.grandTotal, 0);
});

test('zero tax rate is valid and charges no GST', () => {
  const t = computeOrderTotals({ items: items(250), taxRatePercent: 0 });
  assert.equal(t.gstAmount, 0);
  assert.equal(t.grandTotal, 250);
});

test('settled order revenue uses what was actually collected, split net vs gst', () => {
  const r = orderRevenue({ paid_cash: 305, paid_upi: 0, paid_card: 0, grand_total: 305, tax_rate_percent: 5 });
  assert.equal(r.gross, 305);
  assert.equal(r.net, 290.48);
  assert.equal(r.gst, 14.52);
});

test('unsettled order revenue falls back to the pre-tax subtotal', () => {
  const r = orderRevenue({ order_items: items(100, 50) });
  assert.equal(r.gross, 150);
  assert.equal(r.net, 150);
});
```

- [ ] **Step 2: Add the test script to package.json**

In `package.json` `"scripts"`, add:

```json
"test": "node --test src/lib/"
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './orderTotals.js'`

- [ ] **Step 4: Write the implementation**

```javascript
// src/lib/orderTotals.js
// Single source of truth for every rupee figure the POS shows, prints, collects or
// reports. Before this module the same subtotal/GST/discount math was re-implemented in
// 25 places across 5 files, each slightly differently — which is why the on-screen total,
// the printed bill and the dashboard could all disagree about the same order.
//
// ponytail: plain JS floats rounded at each boundary, not integer paise. Correct to the
// rupee for restaurant-sized bills; switch to integer paise if totals ever reach the
// range where 2-decimal float drift is visible (~10^13).

/** Round to 2 decimals without float drift (0.1 + 0.2 style). */
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Sum of non-cancelled line items, before discount and before tax. */
export function computeSubtotal(items = []) {
  return round2(
    (items || [])
      .filter(i => i.status !== 'cancelled')
      .reduce((sum, i) => sum + Number(i.price || 0) * Number(i.quantity || 0), 0)
  );
}

/**
 * Discount in rupees, clamped to [0, subtotal]. Without the clamp a flat discount larger
 * than the bill (or a percentage above 100) drove the taxable value negative and charged
 * GST backwards.
 */
export function computeDiscount(subtotal, discountType, discountValue) {
  const raw = Number(discountValue) || 0;
  if (raw <= 0) return 0;
  const amount = discountType === '%' ? subtotal * (Math.min(raw, 100) / 100) : raw;
  return round2(Math.min(Math.max(amount, 0), subtotal));
}

/**
 * The complete bill breakdown. GST is exclusive (added on top of menu prices) and split
 * evenly into CGST + SGST. The payable is rounded to a whole rupee with the difference
 * carried as `roundOff`, so the screen, the printout and the cash drawer always agree.
 */
export function computeOrderTotals({
  items = [],
  discountType = '%',
  discountValue = 0,
  taxRatePercent = 0,
} = {}) {
  const subtotal = computeSubtotal(items);
  const discountAmount = computeDiscount(subtotal, discountType, discountValue);
  const taxableValue = round2(subtotal - discountAmount);
  const rate = Number(taxRatePercent) || 0;
  const cgstAmount = round2((taxableValue * (rate / 2)) / 100);
  const sgstAmount = cgstAmount;
  const gstAmount = round2(cgstAmount + sgstAmount);
  const rawGrandTotal = round2(taxableValue + gstAmount);
  const grandTotal = Math.round(rawGrandTotal);
  const roundOff = round2(grandTotal - rawGrandTotal);

  return {
    subtotal, discountAmount, taxableValue, taxRatePercent: rate,
    cgstAmount, sgstAmount, gstAmount, rawGrandTotal, grandTotal, roundOff,
  };
}

/**
 * Revenue for dashboards and reports.
 * A settled order stores what was actually collected in paid_cash/paid_upi/paid_card —
 * that sum already reflects the discount, the GST and the round-off, so it is the truth.
 * An unsettled order has no discount decided yet, so it falls back to the pre-tax subtotal.
 */
export function orderRevenue(order = {}, fallbackTaxRatePercent = 0) {
  const collected = round2(
    (Number(order.paid_cash) || 0) + (Number(order.paid_upi) || 0) + (Number(order.paid_card) || 0)
  );

  if (collected > 0) {
    const stored = Number(order.grand_total) || 0;
    const gross = stored > 0 ? stored : collected;
    const rate = Number(order.tax_rate_percent ?? fallbackTaxRatePercent) || 0;
    const net = rate > 0 ? round2(gross / (1 + rate / 100)) : gross;
    return { gross, net, gst: round2(gross - net) };
  }

  const subtotal = computeSubtotal(order.order_items);
  return { gross: subtotal, net: subtotal, gst: 0 };
}

/** Value lost to cancellations, for the "Lost Revenue" metric. */
export function orderLostRevenue(order = {}) {
  const all = order.order_items || [];
  const lostItems = order.status === 'cancelled' ? all : all.filter(i => i.status === 'cancelled');
  return round2(lostItems.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 7/7 tests.

---

## Task 3: Tax rate loading with a fail-safe

**Files:**
- Create: `src/lib/appSettings.js`
- Modify: `src/App.jsx` (call the loader on startup)

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabase.js`.
- Produces: `loadAppSettings()` → `Promise<object>`; `getTaxRatePercent()` → `number | null` (**`null` means "unknown — block billing"**, `0` means "genuinely zero-rated").

- [ ] **Step 1: Write the module**

```javascript
// src/lib/appSettings.js
// The GST rate used to be read straight from localStorage.print_settings, which is only
// written when someone opens the Settings page. On a fresh install (or after cleared app
// data) the key was simply absent, `parseFloat(undefined) || 0` produced 0, and every bill
// silently went out with no GST and no CGST/SGST lines at all. Loading settings at startup
// removes that cause; getTaxRatePercent() returning null lets the caller refuse to bill
// rather than guess a rate.
import { supabase } from './supabase';

const CACHE_KEY = 'print_settings';

/** Fetch app_settings into the localStorage cache. Call once at startup. */
export async function loadAppSettings() {
  const { data, error } = await supabase.from('app_settings').select('key, value');
  if (error || !data) return readCache();

  const merged = { ...readCache() };
  for (const { key, value } of data) merged[key] = value;
  localStorage.setItem(CACHE_KEY, JSON.stringify(merged));
  return merged;
}

export function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

/**
 * The configured GST percentage, or null if it could not be determined.
 * null is NOT the same as 0 — 0 is a valid zero-rated configuration, null means we do not
 * know and must not issue a bill.
 */
export function getTaxRatePercent() {
  const raw = readCache().tax_rate;
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
```

- [ ] **Step 2: Load settings at app startup**

In `src/App.jsx`, add the import beside the other `src/lib` imports:

```javascript
import { loadAppSettings } from './lib/appSettings';
```

Then in the same mount effect that already calls `fetchOrders()`, `fetchTables()` etc. (around `App.jsx:243-247`), add `loadAppSettings()` to the list of things fetched on mount:

```javascript
      fetchOrders(),
      loadAppSettings(),
      fetchTables(),
```

- [ ] **Step 3: Verify manually**

Run `npm run dev`, open DevTools → Application → Local Storage, delete the `print_settings` key, reload the page, and confirm `print_settings` reappears containing `tax_rate` **without visiting the Settings page**.

---

## Task 4: BillModal — rounding, clamped discount, and blocked billing when the rate is unknown

**Files:**
- Modify: `src/pages/Orders.jsx:1817-1880` (`BillModal` calculation block)
- Modify: `src/pages/Orders.jsx:2140` (grand total display)

**Interfaces:**
- Consumes: `computeOrderTotals` (Task 2), `getTaxRatePercent` (Task 3).
- Produces: `BillModal` calls `onMarkPaid(payment)` where `payment` now also carries `totals` (the full breakdown object from `computeOrderTotals`).

- [ ] **Step 1: Add the imports**

At the top of `src/pages/Orders.jsx`, beside the existing `src/lib` imports:

```javascript
import { computeOrderTotals } from '../lib/orderTotals';
import { getTaxRatePercent } from '../lib/appSettings';
```

- [ ] **Step 2: Replace the calculation block**

Replace the block from `const activeItems = ...` through `const grandTotal = ...` (currently `Orders.jsx:1826-1855`) with:

```javascript
  const activeItems = order.order_items?.filter(i => i.status !== 'cancelled') || [];

  // null (not 0) means the rate could not be determined — billing is blocked below rather
  // than silently issuing a 0% GST bill, which is a compliance problem.
  const taxRatePercent = getTaxRatePercent();
  const isTaxRateKnown = taxRatePercent !== null;
  const printSettingsCache = JSON.parse(localStorage.getItem('print_settings') || '{}');
  const gstin = printSettingsCache.gstin || '';

  const totals = computeOrderTotals({
    items: activeItems,
    discountType,
    discountValue,
    taxRatePercent: taxRatePercent ?? 0,
  });
  const {
    subtotal, discountAmount, taxableValue,
    cgstAmount, sgstAmount, rawGrandTotal, grandTotal, roundOff,
  } = totals;
```

Every later reference in `BillModal` to `subtotal`, `discountAmount`, `taxableValue`, `cgstAmount`, `sgstAmount` and `grandTotal` now resolves to these — and `grandTotal` is the **rounded whole rupee**, so the split-payment autofill at `:1867` and the `remaining` check at `:1871` become correct with no further edit.

- [ ] **Step 3: Show the rounded total and a Round Off line on screen**

Replace the grand total row (currently `Orders.jsx:2138-2142`):

```jsx
          {roundOff !== 0 && (
            <div className="flex justify-between items-center text-sm font-semibold">
              <span className="text-brand-text/60">Round Off</span>
              <span className="text-brand-text">{roundOff > 0 ? '+' : ''}₹{roundOff.toFixed(2)}</span>
            </div>
          )}

          <div className="pt-4 border-t border-brand-glass-border flex justify-between items-center mt-2">
            <span className="font-bold text-brand-text text-lg">Grand Total</span>
            <span className="font-black text-brand-primary text-2xl">₹{grandTotal.toFixed(2)}</span>
          </div>
```

- [ ] **Step 4: Block billing when the rate is unknown**

Immediately above the Actions block (`Orders.jsx:2145`, `{/* Actions */}`), insert the banner:

```jsx
        {!isTaxRateKnown && (
          <div className="mx-5 mb-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm font-bold text-red-500 flex items-center gap-2">
            <AlertTriangle size={16} />
            GST rate unavailable — open Settings &gt; Tax &amp; Billing before billing this order.
          </div>
        )}
```

Add `AlertTriangle` to the `lucide-react` import at the top of `Orders.jsx` if it is not already there (it is — verify).

Then disable both actions. On the Print button (`:2152`) and the Mark Paid button (`:2158-2159`), add the guard:

```jsx
            <button
              disabled={!isTaxRateKnown}
              className="flex-1 flex items-center justify-center gap-2 bg-brand-secondary/30 hover:bg-brand-secondary/50 border border-brand-glass-border text-brand-text font-bold py-3 rounded-xl transition-colors shadow-sm text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handlePrint}
            >
```

and change the Mark Paid button's `disabled` to:

```jsx
              disabled={isMarkingPaid || !isSplitValid || !isTaxRateKnown}
```

- [ ] **Step 5: Pass the breakdown up on settle**

In the Mark Paid `onClick` (`Orders.jsx:2161-2168`), add `totals` to the payload:

```jsx
                onMarkPaid({
                  paid_cash: effectiveAmounts.cash,
                  paid_upi: effectiveAmounts.upi,
                  paid_card: effectiveAmounts.card,
                  summary: paymentSummary(),
                  totals,
                });
```

- [ ] **Step 6: Verify manually**

Run `npm run dev`. Build an order totalling ₹290 with the tax rate set to 5%. Open the bill and confirm the screen reads **Grand Total ₹305.00** with a **Round Off +₹0.50** line. Then delete `print_settings` from localStorage, reopen the bill, and confirm the red banner appears and both Print and Mark Paid are disabled.

---

## Task 5: Persist the breakdown, and print the rounded bill

**Files:**
- Modify: `src/pages/Orders.jsx:765-782` (`handleMarkPaid`)
- Modify: `src/pages/Orders.jsx:1880-1900` (WhatsApp message)
- Modify: `src/pages/Orders.jsx:1975-2005` (print totals block)

**Interfaces:**
- Consumes: `payment.totals` from Task 4.

- [ ] **Step 1: Persist the breakdown when marking paid**

In `handleMarkPaid` (`Orders.jsx:769-776`), extend the update:

```javascript
      const t = payment.totals || {};
      const { error } = await withTimeout(
        supabase.from('orders').update({
          status: 'paid',
          payment_method: payment.summary,
          paid_cash: payment.paid_cash,
          paid_upi: payment.paid_upi,
          paid_card: payment.paid_card,
          // Persisted so a reprint shows the same figures the customer actually paid —
          // previously the discount lived only in BillModal's React state and was lost on close.
          discount_type: t.discountType ?? null,
          discount_value: Number(t.discountValueRaw) || 0,
          discount_amount: t.discountAmount ?? 0,
          taxable_value: t.taxableValue ?? null,
          tax_rate_percent: t.taxRatePercent ?? null,
          cgst_amount: t.cgstAmount ?? 0,
          sgst_amount: t.sgstAmount ?? 0,
          round_off: t.roundOff ?? 0,
          grand_total: t.grandTotal ?? null,
        }).eq('id', order.id)
      );
```

For `discountType`/`discountValueRaw` to exist on `totals`, extend the returned object in `BillModal` (Task 4, Step 2) to carry them:

```javascript
  const totals = {
    ...computeOrderTotals({
      items: activeItems,
      discountType,
      discountValue,
      taxRatePercent: taxRatePercent ?? 0,
    }),
    discountType,
    discountValueRaw: parseFloat(discountValue) || 0,
  };
```

- [ ] **Step 2: Rehydrate a settled bill from the stored breakdown**

So reopening a paid order reprints identically, initialise the discount state from the order (replace the two `useState` lines at `Orders.jsx:1818-1819`):

```javascript
  // A settled order reprints from what was stored at settle time; an open one starts at 0.
  const [discountValue, setDiscountValue] = useState(
    order.status === 'paid' && order.discount_value != null ? String(order.discount_value) : '0'
  );
  const [discountType, setDiscountType] = useState(order.discount_type || '%');
```

- [ ] **Step 3: Print the rounded total with a Round Off line**

In the print template, replace the totals block (`Orders.jsx:1989-2002`) so the round-off is shown and `TOTAL` is the whole rupee:

```javascript
            ${taxRatePercent > 0 ? `
            <div class="total-row" style="font-size: 11px; font-weight: normal;">
              <span>CGST (${(taxRatePercent / 2).toFixed(2)}%)</span>
              <span>Rs.${cgstAmount.toFixed(2)}</span>
            </div>
            <div class="total-row" style="font-size: 11px; font-weight: normal;">
              <span>SGST (${(taxRatePercent / 2).toFixed(2)}%)</span>
              <span>Rs.${sgstAmount.toFixed(2)}</span>
            </div>` : ''}
            ${roundOff !== 0 ? `
            <div class="total-row" style="font-size: 11px; font-weight: normal;">
              <span>Round Off</span>
              <span>${roundOff > 0 ? '+' : ''}Rs.${roundOff.toFixed(2)}</span>
            </div>` : ''}
            <hr class="line" />
            <div class="total-row">
              <span>TOTAL</span>
              <span>Rs.${grandTotal.toFixed(2)}</span>
            </div>
```

- [ ] **Step 4: Match the WhatsApp message**

In `handleWhatsApp` (`Orders.jsx:1897`), replace the grand total line so it also sends the rounded figure:

```javascript
      (roundOff !== 0 ? `\nRound Off: ${roundOff > 0 ? '+' : ''}₹${roundOff.toFixed(2)}` : '') +
      `\n*Grand Total: ₹${grandTotal.toFixed(2)}*\n\nPayment: ${paymentSummary()}`;
```

- [ ] **Step 5: Verify the reported bug is gone**

Run `npm run dev`, build the ₹290 order at 5% GST, and confirm **all four** surfaces read ₹305.00: the on-screen Grand Total, the printed bill's TOTAL, the WhatsApp message, and — after Mark Paid — `SELECT grand_total, round_off FROM orders ORDER BY created_at DESC LIMIT 1;` in Supabase (`305.00` / `0.50`).

---

## Task 6: Route every report through the shared revenue helper

**Files:**
- Modify: `src/pages/Analytics.jsx:42-130`
- Modify: `src/pages/Dashboard.jsx:109-160`
- Modify: `src/pages/Revenue.jsx:57`
- Modify: `src/pages/Reports.jsx:42,89`

**Interfaces:**
- Consumes: `orderRevenue`, `orderLostRevenue`, `computeSubtotal` (Task 2); `getTaxRatePercent` (Task 3).

- [ ] **Step 1: Analytics — replace the local helper**

In `src/pages/Analytics.jsx`, add the import and delete the inline `orderRevenue` helper added previously (`Analytics.jsx:54-69`), replacing its uses:

```javascript
import { orderRevenue, orderLostRevenue, computeSubtotal } from '../lib/orderTotals';
```

In the totals loop, use:

```javascript
    let totalRevenue = 0;            // gross, GST included
    let totalRevenueWithoutGst = 0;  // net of GST
    let totalLostRevenue = 0;
    orders.forEach(o => {
        totalLostRevenue += orderLostRevenue(o);
        if (o.status === 'cancelled') return;
        const { gross, net } = orderRevenue(o, taxRatePercent);
        totalRevenue += gross;
        totalRevenueWithoutGst += net;
    });
```

and in the trend loop replace the inline destructure with the same call:

```javascript
          const { net } = orderRevenue(o, taxRatePercent);
          trendsMap[dateKey].revenue += net;
          trendsMap[dateKey].profit += net;
          trendsMap[dateKey].lostRevenue += orderLostRevenue(o);
```

- [ ] **Step 2: Dashboard — use net revenue**

In `src/pages/Dashboard.jsx`, add:

```javascript
import { orderRevenue, orderLostRevenue } from '../lib/orderTotals';
import { getTaxRatePercent } from '../lib/appSettings';
```

Replace the revenue reduce (`Dashboard.jsx:109-113`):

```javascript
    const rate = getTaxRatePercent() ?? 0;
    const revenue = completedOrders.reduce((sum, order) => sum + orderRevenue(order, rate).net, 0);
```

Replace the lost-revenue reduce (`Dashboard.jsx:114-122`):

```javascript
    const lostRevenue = periodOrders.reduce((sum, order) => sum + orderLostRevenue(order), 0);
```

Replace the per-day revenue (`Dashboard.jsx:156-160`):

```javascript
    const dRev = dayOrders.reduce((sum, order) => sum + orderRevenue(order, rate).net, 0);
```

- [ ] **Step 3: Revenue page**

In `src/pages/Revenue.jsx` add `import { orderRevenue } from '../lib/orderTotals';` and `import { getTaxRatePercent } from '../lib/appSettings';`, then replace line 57:

```javascript
      const orderTotal = orderRevenue(order, getTaxRatePercent() ?? 0).gross;
```

- [ ] **Step 4: Reports page**

In `src/pages/Reports.jsx` add the same two imports, then replace line 42:

```javascript
          .reduce((t, o) => t + orderRevenue(o, getTaxRatePercent() ?? 0).net, 0);
```

and line 89 (the CSV row total):

```javascript
          const total = orderRevenue(o, getTaxRatePercent() ?? 0).gross;
```

- [ ] **Step 5: Verify consistency**

Run `npm run dev`. Settle one order for a known amount, then confirm Analytics "Revenue (with GST)", the Revenue page row, and the Reports CSV total all show that **same** collected figure, and that Dashboard/Analytics net revenue equals it divided by `1 + rate/100`.

---

## Task 7: Order numbers from Postgres only

**Files:**
- Modify: `local-server/db.js:29-40` (drop the local counter)
- Modify: `local-server/index.js:88-146` (stop assigning locally)
- Modify: `local-server/sync.js:55-65` (omit `order_number` so the DB default fires)

**Interfaces:**
- Consumes: the sequence created in Task 1.

- [ ] **Step 1: Stop assigning order numbers in local-server**

In `local-server/index.js`, replace the `db.get('UPDATE order_counter ...')` wrapper (`:93-98`) so the insert no longer supplies a number. The order INSERT becomes:

```javascript
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(
          `INSERT INTO orders (id, table_no, customer_name, mobile_no, status, notes, created_at, synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [orderId, table_no, customer_name, mobile_no, 'pending', notes, createdAt, 0],
```

Remove the now-unused `counterErr`/`counterRow` closure and its closing brace, keeping the rest of the handler intact.

- [ ] **Step 2: Retire the local counter table**

In `local-server/db.js`, replace the `order_counter` block with a comment recording why it is gone:

```javascript
  // Order numbers come from the Postgres sequence `orders_order_number_seq` (see
  // database_scripts/2026-08-19_billing_and_order_number.sql). The old per-machine SQLite
  // counter that lived here handed out numbers independently on every terminal, so a
  // second terminal would have issued duplicate order IDs. Offline-created orders receive
  // their number from Postgres when they sync.
```

- [ ] **Step 3: Let the database assign the number on sync**

In `local-server/sync.js`, remove `order_number: order.order_number` from the upsert object (`:64`) so the column default fires on insert and an existing number is left untouched on update.

- [ ] **Step 4: Verify**

Restart the app (`npm run electron:dev`). Create two orders from the POS UI. Confirm in Supabase that both have sequential, non-null `order_number` values continuing from 24, and that the KOT/Bill print shows that number rather than a 4-digit hash:

```sql
SELECT order_number, table_no, created_at FROM orders ORDER BY created_at DESC LIMIT 5;
```

---

## Task 8: Fix the KDS checkbox reset

**Files:**
- Modify: `src/App.jsx:591-601` (deterministic item ordering)
- Modify: `src/pages/Orders.jsx:714-718` (dual-write `prepared`)
- Modify: `local-server/db.js:39-52` (add `prepared`)
- Modify: `local-server/index.js` (add the update endpoint)
- Modify: `local-server/sync.js:76-88` (include `prepared`)

**Interfaces:**
- Produces: `PATCH /api/order-items/:id/prepared` on local-server, body `{ prepared: boolean }`.

- [ ] **Step 1: Order items deterministically**

In `src/App.jsx`, add ordering to the Supabase query (`:591-595`) so a ticked item does not jump position when Postgres returns the rewritten row in a new place:

```javascript
    supabase
      .from('orders')
      .select('*, order_items (*)')
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .order('created_at', { referencedTable: 'order_items', ascending: true })
      .order('id', { referencedTable: 'order_items', ascending: true })
```

- [ ] **Step 2: Add `prepared` to the local SQLite schema**

In `local-server/db.js`, add the column to the `order_items` CREATE TABLE and a migration for existing installs:

```javascript
      created_at TEXT,
      synced INTEGER DEFAULT 0,
      prepared INTEGER DEFAULT 0
    )
  `);

  // Existing installs predate the column. Without it, local rows come back with no
  // `prepared` field and — because App.jsx uses local orders as the base set — every
  // refresh wiped the KDS checkmarks the user had just ticked.
  db.run('ALTER TABLE order_items ADD COLUMN prepared INTEGER DEFAULT 0', () => {});
```

- [ ] **Step 3: Add the local endpoint**

In `local-server/index.js`, beside the other order routes:

```javascript
// ─── PATCH mark an item prepared/unprepared (KDS checkbox) ───
app.patch('/api/order-items/:id/prepared', (req, res) => {
  const { prepared } = req.body;
  db.run(
    'UPDATE order_items SET prepared = ? WHERE id = ?',
    [prepared ? 1 : 0, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, updated: this.changes });
    }
  );
});
```

- [ ] **Step 4: Dual-write from the renderer**

In `src/pages/Orders.jsx`, replace `toggleItemChecked` (`:714-718`):

```javascript
  // Written to BOTH Supabase and the local SQLite mirror. App.jsx uses local orders as the
  // base set on refresh, so a Supabase-only write was overwritten by the stale local row
  // and the checkmark visibly reset a moment after being ticked.
  const toggleItemChecked = useCallback(async (itemId, currentValue) => {
    const next = !currentValue;
    const { error } = await supabase.from('order_items').update({ prepared: next }).eq('id', itemId);
    if (error) {
      toast.error('Failed to update item');
      return;
    }
    if (window.LOCAL_API_KEY) {
      try {
        const host = window.location.hostname || 'localhost';
        await fetch(`http://${host}:3000/api/order-items/${itemId}/prepared`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-api-key': window.LOCAL_API_KEY },
          body: JSON.stringify({ prepared: next }),
        });
      } catch (localError) {
        console.error('Local prepared update failed:', localError);
      }
    }
    refreshOrders();
  }, [refreshOrders]);
```

- [ ] **Step 5: Include `prepared` in the sync payload**

In `local-server/sync.js`, add to the `order_items` upsert object (`:78-88`):

```javascript
        created_at: item.created_at,
        prepared: !!item.prepared,
```

- [ ] **Step 6: Sort items stably at render**

In `src/pages/Orders.jsx`, in `OrderCard`, sort before mapping so local and Supabase orderings agree. Replace `order.order_items?.map(item => {` in the non-merged branch (`:1074`) with:

```jsx
            [...(order.order_items || [])]
              .sort((a, b) => (a.batch || 1) - (b.batch || 1)
                || String(a.created_at || '').localeCompare(String(b.created_at || ''))
                || String(a.id).localeCompare(String(b.id)))
              .map(item => {
```

Apply the same comparator to `batchItems` in the merged branch (`:1030`):

```javascript
              const batchItems = (order.order_items?.filter(i => (i.batch || 1) === batch) || [])
                .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))
                  || String(a.id).localeCompare(String(b.id)));
```

- [ ] **Step 7: Verify**

Run `npm run electron:dev` (Electron, so local-server is live — the bug does not reproduce under plain `npm run dev`). Open a pending order with 4+ items, tick the second item, and confirm: it stays green, it does **not** change position, and it is still green after 20 seconds (past a sync cycle) and after switching to the Done tab and back.

---

## Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Automated checks**

```bash
npm test
npm run lint
npm run build
```

Expected: tests pass; `build` succeeds. (`lint` has pre-existing unrelated warnings across the repo — compare against a file you did not touch and confirm you added no new errors.)

- [ ] **Step 2: End-to-end billing check**

With the tax rate set to 5%, create an order totalling ₹290 and confirm:

| Surface | Expected |
|---|---|
| Bill modal on screen | Subtotal 290.00, CGST 7.25, SGST 7.25, Round Off +0.50, **Grand Total ₹305.00** |
| Printed bill | Same figures, **TOTAL Rs.305.00** |
| WhatsApp message | **Grand Total: ₹305.00** |
| `orders` row after settle | `grand_total = 305.00`, `round_off = 0.50`, `cgst_amount = 7.25`, `paid_*` summing to 305.00 |
| Analytics "Revenue (with GST)" | includes 305.00 |
| Analytics "Revenue (without GST)" | includes 290.48 |

- [ ] **Step 3: Regression checks for the other fixes**

- Apply a ₹9999 flat discount to a ₹200 order → taxable value 0, GST 0, Grand Total ₹0 (never negative).
- Delete `print_settings` from localStorage, reopen a bill → red banner, Print and Mark Paid both disabled.
- Create two orders → sequential `order_number`s from 24 upward, shown on KOT and Bill.
- Tick a KDS checkbox → stays ticked and in place across a refresh and a tab switch.

- [ ] **Step 4: Ship**

Bump `version` in `package.json`, then:

```powershell
$env:GH_TOKEN = (Get-Content .env | Where-Object { $_ -match '^GH_TOKEN=' } -split '=',2)[1]
npm run electron:build -- --publish always
```

Confirm the published `latest.yml` reports the new version before relying on the auto-updater.

---

## Self-Review

**Spec coverage:** All six audit findings map to tasks — round-off (4, 5), GST silently 0% (3, 4), reports missing GST (6), discount not persisted/unclamped (2, 4, 5), order ID (1, 7), checkbox (8). Global constraints on idempotent SQL (1), no new deps (2), and history untouched (1 adds columns with defaults, no `UPDATE` of existing rows) are honoured.

**Placeholder scan:** No TBDs; every code step carries the literal code to write.

**Type consistency:** `computeOrderTotals` returns the same field names consumed in Tasks 4–6; `orderRevenue` returns `{gross, net, gst}` used consistently in Task 6; `getTaxRatePercent()` returns `number | null` and every caller handles `null` (`?? 0` in reports, explicit block in billing).

**Known ordering constraint:** Task 1 must run before Tasks 5, 7 and 8 — the columns, sequence and `prepared` field must exist before code writes to them.
