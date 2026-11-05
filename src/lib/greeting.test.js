import test from 'node:test';
import assert from 'node:assert/strict';
import { greetingFor, GREETING_REFRESH_MS } from './greeting.js';

// Build a Date at a given local wall-clock hour, since greetingFor reads local time —
// the till is greeted by the clock on the wall, not by UTC.
const at = (hour) => new Date(2026, 8, 1, hour, 30, 0);

test('morning runs 05:00 to 11:59', () => {
  assert.equal(greetingFor(at(5)), 'Good Morning');
  assert.equal(greetingFor(at(11)), 'Good Morning');
});

test('afternoon runs 12:00 to 16:59', () => {
  assert.equal(greetingFor(at(12)), 'Good Afternoon');
  assert.equal(greetingFor(at(16)), 'Good Afternoon');
});

test('evening runs 17:00 to 20:59', () => {
  assert.equal(greetingFor(at(17)), 'Good Evening');
  assert.equal(greetingFor(at(20)), 'Good Evening');
});

test('night covers 21:00 through 04:59, across midnight', () => {
  assert.equal(greetingFor(at(21)), 'Good Night');
  assert.equal(greetingFor(at(23)), 'Good Night');
  assert.equal(greetingFor(at(0)), 'Good Night');
  assert.equal(greetingFor(at(4)), 'Good Night');
});

test('every hour of the day produces a greeting', () => {
  for (let h = 0; h < 24; h++) {
    assert.match(greetingFor(at(h)), /^Good (Morning|Afternoon|Evening|Night)$/);
  }
});

test('defaults to now when called with no argument', () => {
  assert.match(greetingFor(), /^Good (Morning|Afternoon|Evening|Night)$/);
});

test('refresh interval is fine enough to catch a boundary within the minute', () => {
  assert.ok(GREETING_REFRESH_MS <= 60000);
});
