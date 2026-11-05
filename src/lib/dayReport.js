// Bill-level and day-level reporting, built on top of src/lib/orderTotals.js.
//
// orderTotals.js answers "what is one order worth". This module answers the two questions
// the owner actually asks at closing time:
//
//   1. Show me the bills — order by order, with the discount and the final amount.
//   2. Show me the day — how much came in as cash, as UPI, as card; what went out; what's left.
//
// Both the Revenue page and the Analytics page consume these functions, for the same
// reason orderTotals.js exists: the moment two screens each compute "the day's collection"
// their own way, they disagree, and the owner cannot tell which one to trust.

import { round2, computeOrderTotals, isRevenueOrder } from './orderTotals.js';
import { businessDayOf } from './businessDay.js';

/** The payment modes the cafe settles in, in the order they are shown. */
export const PAYMENT_METHODS = ['Cash', 'UPI / Online', 'Card'];

/**
 * Map a legacy free-text `payment_method` onto a canonical mode.
 * Orders predating the split-payment columns carry spelling variants ("Online/UPI" vs
 * "Online / UPI"), which would otherwise fragment one mode into several rows.
 */
export function normalizeLegacyMethod(raw) {
  const m = String(raw || '').toLowerCase();
  if (m.includes('cash')) return 'Cash';
  if (m.includes('card')) return 'Card';
  return 'UPI / Online';
}

/** What was actually taken at the till for this order, per mode. */
export function collectedByMethod(order = {}) {
  return {
    'Cash': round2(Number(order.paid_cash) || 0),
    'UPI / Online': round2(Number(order.paid_upi) || 0),
    'Card': round2(Number(order.paid_card) || 0),
  };
}

/** Human label for the discount that was applied, or null when there was none. */
function discountLabelFor(order, discountAmount) {
  if (discountAmount <= 0) return null;
  const value = Number(order.discount_value) || 0;
  if (order.discount_type === '%' && value > 0) return `${value}%`;
  return 'Flat';
}

/**
 * One order rendered as a bill row: subtotal, discount, GST and the FINAL amount.
 *
 * Three cases, in order of trustworthiness:
 *   1. A settled bill with its breakdown persisted — the stored columns are the truth,
 *      because that is literally what was printed and handed to the customer.
 *   2. A settled bill from before the breakdown columns existed — we know what was
 *      collected, so that is the final amount; the split is reconstructed from the rate.
 *   3. An open order — nothing is settled yet, so the bill is projected from the live
 *      items and whatever discount has been entered so far. This is what the KDS card
 *      shows, and it becomes exactly case 1 the moment the bill is settled.
 */
export function billRow(order = {}, fallbackTaxRatePercent = 0) {
  const items = (order.order_items || []).filter(i => i.status !== 'cancelled');
  const payments = collectedByMethod(order);
  const collected = round2(payments['Cash'] + payments['UPI / Online'] + payments['Card']);
  const rate = Number(order.tax_rate_percent ?? fallbackTaxRatePercent) || 0;

  let subtotal, discountAmount, taxableValue, gstAmount, roundOff, finalAmount, isEstimate;

  if (order.grand_total != null && Number(order.grand_total) > 0) {
    // Case 1 — reprint the stored bill exactly.
    discountAmount = round2(Number(order.discount_amount) || 0);
    taxableValue = round2(Number(order.taxable_value) || 0);
    subtotal = round2(taxableValue + discountAmount);
    gstAmount = round2((Number(order.cgst_amount) || 0) + (Number(order.sgst_amount) || 0));
    roundOff = round2(Number(order.round_off) || 0);
    finalAmount = round2(Number(order.grand_total));
    isEstimate = false;
  } else if (collected > 0) {
    // Case 2 — settled before the breakdown was persisted. Only the collected sum is known.
    finalAmount = collected;
    taxableValue = rate > 0 ? round2(finalAmount / (1 + rate / 100)) : finalAmount;
    gstAmount = round2(finalAmount - taxableValue);
    subtotal = taxableValue;
    discountAmount = 0;
    roundOff = 0;
    isEstimate = false;
  } else {
    // Case 3 — open order, projected with the same math the bill modal will use.
    const t = computeOrderTotals({
      items,
      discountType: order.discount_type || '%',
      discountValue: order.discount_value || 0,
      taxRatePercent: rate,
    });
    ({ subtotal, discountAmount, taxableValue, gstAmount, roundOff } = t);
    finalAmount = t.grandTotal;
    isEstimate = true;
  }

  return {
    id: order.id,
    orderNumber: order.order_number ?? null,
    // Gap-free, assigned by trigger when the order is paid — see
    // database_scripts/2026-09-12_invoice_number.sql. Null until then.
    invoiceNumber: order.invoice_number ?? null,
    createdAt: order.created_at,
    businessDay: order.created_at ? businessDayOf(order.created_at) : null,
    customerName: order.customer_name || null,
    tableNo: order.table_no || null,
    status: order.status,
    itemCount: items.reduce((n, i) => n + (Number(i.quantity) || 0), 0),
    items,
    subtotal,
    discountAmount,
    discountLabel: discountLabelFor(order, discountAmount),
    taxableValue,
    taxRatePercent: rate,
    gstAmount,
    roundOff,
    finalAmount,
    collected,
    payments,
    // Which bucket(s) this bill's money belongs to. A split bill lists every mode it
    // used, so filtering by Cash finds a ₹500-cash + ₹445-UPI bill under both.
    // Defined once here so the Analytics breakdown and the Revenue filter can never
    // classify the same bill differently.
    paymentModes:
      collected > 0 ? PAYMENT_METHODS.filter(m => payments[m] > 0)
      : order.status === 'paid' ? [normalizeLegacyMethod(order.payment_method)]
      : isRevenueOrder(order) ? [UNPAID]
      : [],
    // Projected rather than settled — the caller should not present it as money in hand.
    isEstimate,
    isRevenue: isRevenueOrder(order),
  };
}

/**
 * The final payable for one order — the single number the KDS card and the bill agree on.
 * Thin wrapper so callers that want only the amount don't build a whole row.
 */
export function orderFinalAmount(order = {}, fallbackTaxRatePercent = 0) {
  return billRow(order, fallbackTaxRatePercent).finalAmount;
}

/**
 * Each line item's share of what the order actually earned.
 *
 * A discount is given on the bill as a whole, not on any one dish, so "revenue by
 * category" and "top tables by revenue" can only be built by allocating that discount
 * back across the lines — pro-rata by line value, which is the convention every till
 * report uses. The `net` figures sum to the order's taxable value, so these breakdowns
 * reconcile with the headline "Revenue (without GST)" instead of quietly overstating it
 * by the whole discount.
 *
 * `gross` is kept alongside for callers that want menu-price totals (e.g. quantities
 * sold at list price).
 */
export function itemRevenueLines(order = {}, fallbackTaxRatePercent = 0) {
  const row = billRow(order, fallbackTaxRatePercent);
  const lines = row.items.map(item => ({
    item,
    gross: round2(Number(item.price || 0) * Number(item.quantity || 0)),
  }));

  // Allocate against the lines' own total rather than row.subtotal: for a pre-migration
  // bill those two differ, and dividing by the wrong one would skew every share.
  const grossTotal = round2(lines.reduce((s, l) => s + l.gross, 0));

  return lines.map(l => ({
    ...l,
    net: grossTotal > 0 ? round2(row.taxableValue * (l.gross / grossTotal)) : 0,
  }));
}

/**
 * Bills served but not yet settled. Reported as their own line so they reconcile against
 * revenue instead of being guessed onto a payment mode.
 */
export const UNPAID = 'Done, not yet paid';

/**
 * Amount and order count per payment mode, over revenue orders.
 *
 * Every rupee of revenue lands in exactly one bucket, so the buckets sum to the revenue
 * card — that is the whole point of this function:
 *   - paid with a split recorded      → each mode it used
 *   - paid, pre-migration (no split)  → the legacy `payment_method` text (real money)
 *   - done but never paid             → UNPAID, never a payment mode
 *
 * That last case is the fix for "cash + UPI + card doesn't add up": a done-but-unpaid
 * order fell through to `payment_method`, whose default is 'Online / UPI', so UPI was
 * inflated with money that had never been taken and the owner could not see what was
 * actually outstanding.
 */
export function paymentBreakdown(orders = [], fallbackTaxRatePercent = 0) {
  const totals = new Map(
    [...PAYMENT_METHODS, UNPAID].map(name => [name, { name, amount: 0, orders: 0, isUnpaid: name === UNPAID }])
  );
  const add = (name, amount) => {
    const bucket = totals.get(name);
    bucket.amount = round2(bucket.amount + amount);
    bucket.orders += 1;
  };

  for (const order of orders) {
    if (!isRevenueOrder(order)) continue;
    const row = billRow(order, fallbackTaxRatePercent);
    if (row.finalAmount <= 0) continue;

    // Buckets come from row.paymentModes, the same classification the Revenue filter
    // uses. A split bill contributes its per-mode amount; anything else, its whole total.
    for (const name of row.paymentModes) {
      add(name, row.collected > 0 ? row.payments[name] : row.finalAmount);
    }
  }

  return [...totals.values()].filter(b => b.orders > 0);
}

/**
 * Everything the owner needs to close the till for a period: what was billed, what was
 * discounted, how it was paid, what was spent, and what is actually left.
 */
export function daySummary({ orders = [], expenses = [], taxRatePercent = 0 } = {}) {
  const rows = orders.filter(isRevenueOrder).map(o => billRow(o, taxRatePercent));

  const grossRevenue = round2(rows.reduce((s, r) => s + r.finalAmount, 0));
  const totalDiscount = round2(rows.reduce((s, r) => s + r.discountAmount, 0));
  const gstCollected = round2(rows.reduce((s, r) => s + r.gstAmount, 0));
  // GST is collected on the government's behalf, so it is never the cafe's income.
  const netRevenue = round2(grossRevenue - gstCollected);
  const totalExpenses = round2(expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0));

  const payments = paymentBreakdown(orders, taxRatePercent);
  // Money in hand. Unpaid bills are revenue on the books but not cash in the drawer.
  const totalCollection = round2(payments.filter(p => !p.isUnpaid).reduce((s, p) => s + p.amount, 0));
  const unpaidAmount = round2(payments.filter(p => p.isUnpaid).reduce((s, p) => s + p.amount, 0));

  return {
    orderCount: rows.length,
    grossRevenue,
    totalDiscount,
    gstCollected,
    netRevenue,
    totalExpenses,
    // What the day actually earned: takings net of tax, less what was spent.
    dayEndRevenue: round2(netRevenue - totalExpenses),
    // Invariant the owner can check by eye: collection + unpaid === grossRevenue.
    totalCollection,
    unpaidAmount,
    payments,
  };
}

/**
 * Bill rows folded into one row per business day, newest day first — the date-wise
 * revenue report. Days with no trade simply don't appear.
 */
export function groupByBusinessDay(rows = []) {
  const byDay = new Map();

  for (const row of rows) {
    if (!row.businessDay) continue;
    if (!byDay.has(row.businessDay)) {
      byDay.set(row.businessDay, {
        day: row.businessDay,
        orders: 0, subtotal: 0, discount: 0, gst: 0, final: 0,
      });
    }
    const bucket = byDay.get(row.businessDay);
    bucket.orders += 1;
    bucket.subtotal = round2(bucket.subtotal + row.subtotal);
    bucket.discount = round2(bucket.discount + row.discountAmount);
    bucket.gst = round2(bucket.gst + row.gstAmount);
    bucket.final = round2(bucket.final + row.finalAmount);
  }

  return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
}
