import test from 'node:test';
import assert from 'node:assert/strict';
import {
  billRow, orderFinalAmount, paymentBreakdown, daySummary, groupByBusinessDay,
  itemRevenueLines, normalizeLegacyMethod, PAYMENT_METHODS, UNPAID,
} from './dayReport.js';

const items = (...prices) =>
  prices.map((p, i) => ({ id: String(i), price: p, quantity: 1, status: 'active' }));

// A bill settled through the modern flow: the breakdown is persisted on the order.
const settledOrder = {
  id: 'a', order_number: 41, status: 'paid', created_at: '2026-08-30T14:00:00Z',
  order_items: items(1000),
  discount_type: '%', discount_value: 10, discount_amount: 100,
  taxable_value: 900, tax_rate_percent: 5, cgst_amount: 22.5, sgst_amount: 22.5,
  round_off: 0, grand_total: 945,
  paid_cash: 500, paid_upi: 445, paid_card: 0,
};

test('a settled bill reports the stored breakdown, not a recomputed one', () => {
  const row = billRow(settledOrder);
  assert.equal(row.subtotal, 1000);
  assert.equal(row.discountAmount, 100);
  assert.equal(row.gstAmount, 45);
  assert.equal(row.finalAmount, 945);
  assert.equal(row.discountLabel, '10%');
  assert.equal(row.isEstimate, false);
});

test('the final amount is the grand total, never the raw item subtotal', () => {
  // The KDS bug: it showed 1000 while the customer was handed a bill for 945.
  assert.equal(orderFinalAmount(settledOrder), 945);
});

test('an open order projects the same total the bill modal will charge', () => {
  const open = {
    id: 'b', status: 'pending', created_at: '2026-08-30T14:00:00Z',
    order_items: items(290),
  };
  const row = billRow(open, 5);
  // 290 + 5% = 304.50, rounded to a whole rupee — matches computeOrderTotals.
  assert.equal(row.finalAmount, 305);
  assert.equal(row.isEstimate, true);
});

test('an open order with a discount entered reflects that discount', () => {
  const open = {
    id: 'c', status: 'pending', created_at: '2026-08-30T14:00:00Z',
    order_items: items(1000), discount_type: '%', discount_value: 10,
  };
  const row = billRow(open, 5);
  assert.equal(row.discountAmount, 100);
  assert.equal(row.finalAmount, 945);
});

test('a pre-migration settled bill uses what was collected as the final amount', () => {
  const legacy = {
    id: 'd', status: 'paid', created_at: '2026-08-30T14:00:00Z',
    order_items: items(200), paid_cash: 210, tax_rate_percent: 5,
  };
  const row = billRow(legacy);
  assert.equal(row.finalAmount, 210);
  assert.equal(row.gstAmount, 10);
  assert.equal(row.isEstimate, false);
});

test('cancelled line items never reach the bill', () => {
  const order = {
    id: 'e', status: 'pending', created_at: '2026-08-30T14:00:00Z',
    order_items: [...items(100), { id: 'x', price: 900, quantity: 1, status: 'cancelled' }],
  };
  assert.equal(billRow(order, 0).finalAmount, 100);
});

test('line revenue sums to the order taxable value, discount allocated pro-rata', () => {
  // 1000 subtotal, 10% off -> 900 taxable, split 60/40 across two lines.
  const order = {
    id: 'p', status: 'paid', created_at: '2026-08-30T14:00:00Z',
    order_items: [
      { id: 'a', price: 600, quantity: 1, status: 'active' },
      { id: 'b', price: 400, quantity: 1, status: 'active' },
    ],
    discount_amount: 100, taxable_value: 900, tax_rate_percent: 5,
    cgst_amount: 22.5, sgst_amount: 22.5, grand_total: 945, paid_cash: 945,
  };
  const lines = itemRevenueLines(order);
  assert.deepEqual(lines.map(l => l.gross), [600, 400]);
  assert.deepEqual(lines.map(l => l.net), [540, 360]);
  assert.equal(lines.reduce((s, l) => s + l.net, 0), 900);
});

test('with no discount, line revenue is just the line value', () => {
  const order = {
    id: 'q', status: 'paid', created_at: '2026-08-30T14:00:00Z',
    order_items: items(250), taxable_value: 250, grand_total: 250, paid_cash: 250,
  };
  assert.deepEqual(itemRevenueLines(order).map(l => l.net), [250]);
});

test('a fully discounted bill allocates zero revenue rather than dividing by zero', () => {
  const order = {
    id: 'r', status: 'paid', created_at: '2026-08-30T14:00:00Z',
    order_items: items(0), taxable_value: 0, grand_total: 0,
  };
  assert.deepEqual(itemRevenueLines(order).map(l => l.net), [0]);
});

test('cancelled lines get no revenue allocation', () => {
  const order = {
    id: 's', status: 'paid', created_at: '2026-08-30T14:00:00Z',
    order_items: [
      { id: 'a', price: 100, quantity: 1, status: 'active' },
      { id: 'b', price: 900, quantity: 1, status: 'cancelled' },
    ],
    taxable_value: 100, grand_total: 100, paid_cash: 100,
  };
  const lines = itemRevenueLines(order);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].net, 100);
});

test('legacy payment spellings collapse onto one canonical mode', () => {
  assert.equal(normalizeLegacyMethod('Online/UPI'), 'UPI / Online');
  assert.equal(normalizeLegacyMethod('Online / UPI'), 'UPI / Online');
  assert.equal(normalizeLegacyMethod('CASH'), 'Cash');
  assert.equal(normalizeLegacyMethod('Credit Card'), 'Card');
  assert.equal(normalizeLegacyMethod(null), 'UPI / Online');
});

test('a split payment is attributed to each mode it actually used', () => {
  const breakdown = paymentBreakdown([settledOrder]);
  const byName = Object.fromEntries(breakdown.map(b => [b.name, b]));
  assert.equal(byName['Cash'].amount, 500);
  assert.equal(byName['UPI / Online'].amount, 445);
  assert.equal(byName['Card'], undefined);
  assert.equal(byName['Cash'].orders, 1);
});

test('unpaid orders contribute nothing to the payment breakdown', () => {
  // The reported bug: pending bills were counted as UPI takings that never happened.
  const pending = {
    id: 'f', status: 'pending', created_at: '2026-08-30T14:00:00Z',
    order_items: items(500), payment_method: 'Online / UPI',
  };
  assert.deepEqual(paymentBreakdown([pending]), []);
});

test('a done-but-unpaid order is reported as unpaid, never guessed onto UPI', () => {
  // The reported bug: `payment_method` defaults to 'Online / UPI', so every unpaid bill
  // was silently counted as UPI takings.
  const doneUnpaid = {
    id: 'u', status: 'done', created_at: '2026-08-30T14:00:00Z',
    order_items: items(200), payment_method: 'Online / UPI',
  };
  const byName = Object.fromEntries(paymentBreakdown([doneUnpaid], 5).map(b => [b.name, b]));
  assert.equal(byName['UPI / Online'], undefined);
  assert.equal(byName[UNPAID].amount, 210);
  assert.equal(byName[UNPAID].isUnpaid, true);
});

test('a legacy paid order with no split still counts as real money', () => {
  const legacyPaid = {
    id: 'l', status: 'paid', created_at: '2026-08-30T14:00:00Z',
    order_items: items(200), payment_method: 'Cash',
  };
  const byName = Object.fromEntries(paymentBreakdown([legacyPaid], 5).map(b => [b.name, b]));
  assert.equal(byName['Cash'].amount, 210);
  assert.equal(byName[UNPAID], undefined);
});

test('every rupee of revenue lands in exactly one bucket: buckets sum to gross', () => {
  const doneUnpaid = { id: 'u', status: 'done', created_at: '2026-08-30T14:00:00Z', order_items: items(200) };
  const legacyPaid = { id: 'l', status: 'paid', created_at: '2026-08-30T14:00:00Z', order_items: items(100), payment_method: 'Card' };
  const s = daySummary({ orders: [settledOrder, doneUnpaid, legacyPaid], taxRatePercent: 5 });
  const bucketSum = s.payments.reduce((a, p) => a + p.amount, 0);
  assert.equal(bucketSum, s.grossRevenue);
  assert.equal(s.totalCollection + s.unpaidAmount, s.grossRevenue);
  assert.equal(s.unpaidAmount, 210);
  assert.equal(s.totalCollection, 945 + 105);
});

test('a split bill belongs to every mode it used, so either filter finds it', () => {
  // ₹500 cash + ₹445 UPI: filtering by Cash and by UPI must both return this bill.
  assert.deepEqual(billRow(settledOrder).paymentModes, ['Cash', 'UPI / Online']);
});

test('paymentModes classifies legacy-paid, unpaid and open bills', () => {
  const legacyPaid = { id: 'lp', status: 'paid', order_items: items(200), payment_method: 'Online/UPI' };
  assert.deepEqual(billRow(legacyPaid).paymentModes, ['UPI / Online']);

  const doneUnpaid = { id: 'du', status: 'done', order_items: items(200) };
  assert.deepEqual(billRow(doneUnpaid).paymentModes, [UNPAID]);

  // An open ticket is not revenue and belongs to no bucket at all.
  const pending = { id: 'pd', status: 'pending', order_items: items(200) };
  assert.deepEqual(billRow(pending).paymentModes, []);
});

test('payment modes are reported in a stable order', () => {
  const cashOnly = { ...settledOrder, paid_cash: 945, paid_upi: 0 };
  const cardOnly = { ...settledOrder, id: 'g', paid_cash: 0, paid_upi: 0, paid_card: 945 };
  const names = paymentBreakdown([cardOnly, cashOnly]).map(b => b.name);
  assert.deepEqual(names, PAYMENT_METHODS.filter(n => names.includes(n)));
});

test('the day summary balances: collection equals gross takings', () => {
  const s = daySummary({ orders: [settledOrder], expenses: [{ amount: 200 }], taxRatePercent: 5 });
  assert.equal(s.orderCount, 1);
  assert.equal(s.grossRevenue, 945);
  assert.equal(s.totalCollection, 945);
  assert.equal(s.totalDiscount, 100);
  assert.equal(s.gstCollected, 45);
  assert.equal(s.netRevenue, 900);
  assert.equal(s.totalExpenses, 200);
  assert.equal(s.dayEndRevenue, 700);
});

test('day-end revenue goes negative when expenses outrun takings', () => {
  const s = daySummary({ orders: [settledOrder], expenses: [{ amount: 5000 }], taxRatePercent: 5 });
  assert.equal(s.dayEndRevenue, -4100);
});

test('an empty day summarises to zeros rather than NaN', () => {
  const s = daySummary({});
  assert.equal(s.grossRevenue, 0);
  assert.equal(s.dayEndRevenue, 0);
  assert.deepEqual(s.payments, []);
});

test('bills group into one row per business day, newest first', () => {
  // 2026-08-31T02:00Z is 07:30 IST on the 31st — a normal morning, its own business day.
  // 2026-08-30T21:00Z is 02:30 IST on the 31st — the small hours, so it belongs to the 30th.
  const rows = [
    billRow({ ...settledOrder, id: '1', created_at: '2026-08-31T02:00:00Z' }),
    billRow({ ...settledOrder, id: '2', created_at: '2026-08-30T21:00:00Z' }),
    billRow({ ...settledOrder, id: '3', created_at: '2026-08-30T14:00:00Z' }),
  ];
  const days = groupByBusinessDay(rows);
  assert.deepEqual(days.map(d => d.day), ['2026-08-31', '2026-08-30']);
  assert.equal(days[0].orders, 1);
  assert.equal(days[1].orders, 2);
  assert.equal(days[1].final, 1890);
  assert.equal(days[1].discount, 200);
});

test('grouping ignores rows with no timestamp instead of inventing a day', () => {
  assert.deepEqual(groupByBusinessDay([billRow({ id: 'z', order_items: items(10) })]), []);
});
