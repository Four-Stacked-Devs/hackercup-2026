'use client';

import { useEffect, useState } from 'react';

/**
 * Whole seconds since this mounted.
 *
 * Long waits are honest about themselves: after a while a screen can say it is
 * still working rather than looking stuck. Ticks once a second and stops at
 * `until`, so nothing keeps a timer running for a wait that will not use it.
 */
export function useElapsedSeconds(until = 120): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (seconds >= until) return;

    const timer = setTimeout(() => setSeconds((current) => current + 1), 1_000);
    return () => clearTimeout(timer);
  }, [seconds, until]);

  return seconds;
}
