import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOrderTotals, computeDiscount, orderRevenue, orderLostRevenue, isRevenueOrder } from './orderTotals.js';

const items = (...prices) => prices.map((p, i) => ({ id: String(i), price: p, quantity: 1, status: 'active' }));

test('grand total is a whole rupee and round-off balances it', () => {
  // 290.00 + 5% GST = 304.50 — the exact bug reported: screen said 305, print said 304.50
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

test('percentage discount is applied before GST', () => {
  // 1000 - 10% = 900 taxable, +5% GST = 945
  const t = computeOrderTotals({ items: items(1000), discountType: '%', discountValue: 10, taxRatePercent: 5 });
  assert.equal(t.discountAmount, 100);
  assert.equal(t.taxableValue, 900);
  assert.equal(t.grandTotal, 945);
});

test('settled order revenue uses what was actually collected, split net vs gst', () => {
  const r = orderRevenue({ paid_cash: 305, paid_upi: 0, paid_card: 0, grand_total: 305, tax_rate_percent: 5 });
  assert.equal(r.gross, 305);
  assert.equal(r.net, 290.48);
  assert.equal(r.gst, 14.52);
});

test('unsettled order revenue is the projected bill, GST included', () => {
  // The Revenue card and the payment panel used to value the same done-but-unpaid order
  // two different ways (bare subtotal vs full bill), so cash+UPI+card could never sum to
  // revenue. Both now use this one projection.
  const r = orderRevenue({ order_items: items(100, 50) }, 5);
  assert.equal(r.gross, 158); // 150 + 5% = 157.50, rounded to a whole rupee
  // net/gst are backed out of the rounded gross, exactly as for a settled order.
  assert.equal(r.net, 150.48);
  assert.equal(r.gst, 7.52);
  assert.equal(r.net + r.gst, r.gross);
});

test('unsettled order revenue honours a discount already entered', () => {
  const r = orderRevenue({ order_items: items(1000), discount_type: '%', discount_value: 10 }, 5);
  assert.equal(r.net, 900);
  assert.equal(r.gross, 945);
});

test('unsettled order with zero tax rate is just the subtotal', () => {
  const r = orderRevenue({ order_items: items(100, 50) }, 0);
  assert.equal(r.gross, 150);
  assert.equal(r.gst, 0);
});

test('only settled orders count as revenue — pending ones do not', () => {
  assert.equal(isRevenueOrder({ status: 'paid' }), true);
  assert.equal(isRevenueOrder({ status: 'done' }), true);
  assert.equal(isRevenueOrder({ status: 'pending' }), false);
  assert.equal(isRevenueOrder({ status: 'cancelled' }), false);
});

test('lost revenue counts the whole order when cancelled, else only cancelled lines', () => {
  const cancelledOrder = { status: 'cancelled', order_items: items(100, 50) };
  assert.equal(orderLostRevenue(cancelledOrder), 150);

  const partial = {
    status: 'done',
    order_items: [...items(100), { id: 'c', price: 40, quantity: 2, status: 'cancelled' }],
  };
  assert.equal(orderLostRevenue(partial), 80);
});
