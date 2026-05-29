'use client';

import { useEffect, useRef } from 'react';

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

interface MaybeWakeLockNavigator {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
  };
}

/**
 * Holds a Screen Wake Lock while `active` is true. Re-acquires on
 * `visibilitychange` because browsers release the lock when the tab
 * backgrounds. No-op on browsers without the API.
 */
export function useWakeLock(active: boolean): void {
  const lockRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!active) {
      void lockRef.current?.release();
      lockRef.current = null;
      return;
    }

    const acquire = async (): Promise<void> => {
      const nav = navigator as unknown as MaybeWakeLockNavigator;
      if (!nav.wakeLock) return;
      try {
        lockRef.current = await nav.wakeLock.request('screen');
      } catch {
        // user gesture / permission denied — silent
      }
    };

    void acquire();
    const onVis = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      void lockRef.current?.release();
      lockRef.current = null;
    };
  }, [active]);
}
