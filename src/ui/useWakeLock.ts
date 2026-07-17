/**
 * ui/useWakeLock.ts — hold the screen awake while riding (WR-016, NAVIGATION_SPEC §7).
 *
 * The Screen Wake Lock is auto-released when the tab is hidden, so we re-acquire on
 * visibilitychange whenever it's meant to be held. No-op where the API is unavailable.
 */
import { useEffect } from 'react';

type WakeLockSentinelLike = { release: () => Promise<void> };
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined') return;
    const wl = (navigator as WakeLockNavigator).wakeLock;
    if (!wl) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const s = await wl.request('screen');
        if (cancelled) {
          void s.release();
          return;
        }
        sentinel = s;
      } catch {
        // Denied / not visible — nothing to do; visibilitychange retries.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinel) void sentinel.release();
    };
  }, [active]);
}
