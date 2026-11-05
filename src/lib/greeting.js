// The one definition of "what time of day is it" for every screen that greets someone.
//
// The KDS front page used to render the literal string "Good afternoon" around the clock,
// while the Dashboard carried its own copy of this hour logic. Two copies of a rule is how
// they drift; one module means a staff member at 11pm is told the same thing on both.
//
// Deliberately local wall-clock time, not the 5am business day: a greeting is about the
// clock on the wall, so 01:00 is night even though the till still counts it as last night.

/** Wall-clock boundaries, ordered. Each entry starts at `from` and runs to the next one. */
const BANDS = [
  { from: 5, greeting: 'Good Morning', period: 'morning' },
  { from: 12, greeting: 'Good Afternoon', period: 'afternoon' },
  { from: 17, greeting: 'Good Evening', period: 'evening' },
  { from: 21, greeting: 'Good Night', period: 'night' },
];

/** How often a live clock should re-check the greeting, so a boundary lands within a minute. */
export const GREETING_REFRESH_MS = 60000;

/** 'morning' | 'afternoon' | 'evening' | 'night' for the given time (default: now). */
export function periodFor(date = new Date()) {
  const hour = date.getHours();
  // Below the first boundary means the small hours (00:00–04:59), which belong to night.
  if (hour < BANDS[0].from) return 'night';
  let period = BANDS[0].period;
  for (const band of BANDS) {
    if (hour >= band.from) period = band.period;
  }
  return period;
}

/** 'Good Morning' | 'Good Afternoon' | 'Good Evening' | 'Good Night' (default: now). */
export function greetingFor(date = new Date()) {
  const period = periodFor(date);
  return BANDS.find(b => b.period === period).greeting;
}
