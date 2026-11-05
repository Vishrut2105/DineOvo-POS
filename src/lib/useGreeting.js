// React binding for src/lib/greeting.js — keeps the greeting honest as the clock moves,
// so a terminal left open through the evening doesn't still say "Good Afternoon" at 9pm.
//
// The pure hour logic lives in greeting.js (and is unit-tested there); this file only owns
// the timer, so both the KDS front page and the Dashboard share one implementation.

import { useState, useEffect } from 'react';
import { greetingFor, periodFor, GREETING_REFRESH_MS } from './greeting';

export function useGreeting() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), GREETING_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  return { greeting: greetingFor(now), period: periodFor(now), now };
}
