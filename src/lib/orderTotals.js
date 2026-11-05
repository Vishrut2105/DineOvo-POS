// Single source of truth for every rupee figure the POS shows, prints, collects or
// reports. Before this module the same subtotal/GST/discount math was re-implemented in
// 25 places across 5 files, each slightly differently — which is why the on-screen total,
// the printed bill and the dashboard could all disagree about the same order (the
// reported "₹305 on screen, ₹304.50 on the printout" bug).
//
// ponytail: plain JS floats rounded at each boundary, not integer paise. Correct to the
// rupee for restaurant-sized bills; switch to integer paise if totals ever reach the
// range where 2-decimal float drift becomes visible (~10^13).

/** Round to 2 decimals without float drift (the 0.1 + 0.2 problem). */
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
 * carried as `roundOff`, per the standard Indian GST invoice convention — so the screen,
 * the printout and the cash drawer always agree on one number.
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
 * Does this order count towards revenue?
 *
 * One definition for every page. Analytics previously counted every non-cancelled order —
 * including `pending` ones nobody had paid for yet — while Dashboard and the Revenue page
 * counted only settled ones, so the three pages could never agree on a total.
 */
export function isRevenueOrder(order = {}) {
  return order.status === 'done' || order.status === 'paid';
}

/**
 * Revenue for dashboards and reports.
 * A settled order stores what was actually collected in paid_cash/paid_upi/paid_card —
 * that sum already reflects the discount, the GST and the round-off, so it is the truth.
 * An unsettled order is valued at its PROJECTED bill — the same math BillModal will
 * charge — so every screen agrees on what a done-but-unpaid order is worth. It used to
 * fall back to the bare subtotal here while the payment panel used the full bill, which is
 * why cash + UPI + card never summed to the revenue card.
 */
export function orderRevenue(order = {}, fallbackTaxRatePercent = 0) {
  const collected = round2(
    (Number(order.paid_cash) || 0) + (Number(order.paid_upi) || 0) + (Number(order.paid_card) || 0)
  );
  const rate = Number(order.tax_rate_percent ?? fallbackTaxRatePercent) || 0;

  if (collected > 0) {
    const stored = Number(order.grand_total) || 0;
    const gross = stored > 0 ? stored : collected;
    const net = rate > 0 ? round2(gross / (1 + rate / 100)) : gross;
    return { gross, net, gst: round2(gross - net) };
  }

  const t = computeOrderTotals({
    items: order.order_items,
    discountType: order.discount_type || '%',
    discountValue: order.discount_value || 0,
    taxRatePercent: rate,
  });
  // Split the same way as the settled branch, so the whole-rupee round-off is treated
  // identically whether or not the bill has been paid yet.
  const gross = t.grandTotal;
  const net = rate > 0 ? round2(gross / (1 + rate / 100)) : gross;
  return { gross, net, gst: round2(gross - net) };
}

/** Value lost to cancellations, for the "Lost Revenue" metric. */
export function orderLostRevenue(order = {}) {
  const all = order.order_items || [];
  const lostItems = order.status === 'cancelled' ? all : all.filter(i => i.status === 'cancelled');
  return round2(lostItems.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0));
}
