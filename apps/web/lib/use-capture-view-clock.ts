'use client';

import { useEffect, useRef, useState } from 'react';
import { captureViewElapsed } from './capture-view-clock';

export function useCaptureViewClock(capturing: boolean, finished: boolean): number {
  const startedAt = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (capturing && startedAt.current === null) startedAt.current = Date.now();
    if (startedAt.current === null || finished) return;
    const tick = () => setElapsedMs(captureViewElapsed(startedAt.current, Date.now()));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [capturing, finished]);
  return elapsedMs;
}
