import test from 'node:test';
import assert from 'node:assert/strict';
import {
  businessDayStartUtc,
  businessDayRangeUtc,
  businessDayOf,
  presetRange,
  clampRange,
  MAX_RANGE_DAYS,
} from './businessDay.js';

// The cafe's business day runs 05:00 IST -> 04:59:59 IST the next morning, so a late
// order is counted against the night it was actually served.

test('a business day starts at 05:00 IST, which is 23:30 UTC the previous day', () => {
  assert.equal(businessDayStartUtc('2026-08-25').toISOString(), '2026-08-24T23:30:00.000Z');
});

test('an order just before midnight belongs to that same business day', () => {
  // 25 Aug 11:30 PM IST = 25 Aug 18:00 UTC
  assert.equal(businessDayOf('2026-08-25T18:00:00.000Z'), '2026-08-25');
});

test('an order after midnight still belongs to the PREVIOUS business day', () => {
  // 26 Aug 00:45 IST = 25 Aug 19:15 UTC — the owner counts this as the 25th's trade
  assert.equal(businessDayOf('2026-08-25T19:15:00.000Z'), '2026-08-25');
});

test('an order at 04:59 IST is still the previous business day', () => {
  // 26 Aug 04:59 IST = 25 Aug 23:29 UTC
  assert.equal(businessDayOf('2026-08-25T23:29:00.000Z'), '2026-08-25');
});

test('an order at 05:00 IST starts the new business day', () => {
  // 26 Aug 05:00 IST = 25 Aug 23:30 UTC
  assert.equal(businessDayOf('2026-08-25T23:30:00.000Z'), '2026-08-26');
});

test('a morning order belongs to its own calendar day', () => {
  // 26 Aug 06:00 IST = 26 Aug 00:30 UTC
  assert.equal(businessDayOf('2026-08-26T00:30:00.000Z'), '2026-08-26');
});

test('a range end is exclusive and covers the whole final business day', () => {
  const { fromUtc, toUtc } = businessDayRangeUtc('2026-08-25', '2026-08-25');
  assert.equal(fromUtc, '2026-08-24T23:30:00.000Z');
  // ends when the NEXT business day begins, so 25 Aug 11:59 PM is included
  assert.equal(toUtc, '2026-08-25T23:30:00.000Z');
});

test('a multi-day range spans from the first morning to the last night', () => {
  const { fromUtc, toUtc } = businessDayRangeUtc('2026-08-20', '2026-08-25');
  assert.equal(fromUtc, '2026-08-19T23:30:00.000Z');
  assert.equal(toUtc, '2026-08-25T23:30:00.000Z');
});

test('a reversed range is corrected rather than returning nothing', () => {
  const a = businessDayRangeUtc('2026-08-25', '2026-08-20');
  const b = businessDayRangeUtc('2026-08-20', '2026-08-25');
  assert.deepEqual(a, b);
});

test('every order in a business day falls inside that day\'s range', () => {
  const { fromUtc, toUtc } = businessDayRangeUtc('2026-08-25', '2026-08-25');
  for (const ts of ['2026-08-24T23:30:00.000Z', '2026-08-25T18:00:00.000Z', '2026-08-25T23:29:59.000Z']) {
    assert.ok(ts >= fromUtc && ts < toUtc, `${ts} should be inside the 25 Aug business day`);
    assert.equal(businessDayOf(ts), '2026-08-25');
  }
  // and the instant the next day starts is outside
  assert.ok(!('2026-08-25T23:30:00.000Z' < toUtc));
});

test('presets return valid business-day ranges', () => {
  for (const key of ['today', 'yesterday', 'last7', 'last30', 'thisMonth']) {
    const r = presetRange(key);
    assert.ok(r.fromUtc < r.toUtc, `${key} produced an empty range`);
    assert.match(r.fromUtc, /Z$/);
  }
});

test('yesterday ends exactly where today begins', () => {
  assert.equal(presetRange('yesterday').toUtc, presetRange('today').fromUtc);
});

test('an over-long range is clamped instead of fetching years of data', () => {
  const { from, to, clamped } = clampRange('2020-01-01', '2026-08-25');
  assert.equal(clamped, true);
  assert.equal(to, '2026-08-25');
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  assert.ok(days <= MAX_RANGE_DAYS, `range still ${days} days`);
});

test('a normal range is left alone', () => {
  const { from, to, clamped } = clampRange('2026-08-01', '2026-08-25');
  assert.equal(clamped, false);
  assert.equal(from, '2026-08-01');
  assert.equal(to, '2026-08-25');
});
