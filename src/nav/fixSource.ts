// nav/fixSource.ts — the GPS fix contract (WR-012). Both the replay harness and the live
// geolocation service (WR-013) implement FixSource, so nav is developed against replay and
// validated on the bike (NAVIGATION_SPEC §8).
export interface Fix {
  lat: number;
  lon: number;
  /** Elevation in metres, when available. */
  ele?: number;
  /** ISO-8601 timestamp of the fix. */
  time: string;
  /** Ground speed in m/s, when available. */
  speed?: number;
}

export interface FixSource {
  /** Begin emitting fixes to `handler`. Idempotent-safe callers should stop() first. */
  start(handler: (fix: Fix) => void): void;
  /** Stop emitting and release resources. */
  stop(): void;
}
