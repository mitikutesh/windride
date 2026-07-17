// nav/fixSource.ts — the GPS fix contract (WR-012). Both the replay harness and the live
// geolocation service (WR-013) implement FixSource, so nav is developed against replay and
// validated on the bike (NAVIGATION_SPEC §8). Shaped to map cleanly onto watchPosition/clearWatch.
export interface Fix {
  lat: number;
  lon: number;
  /** Elevation in metres, when available. */
  ele?: number;
  /** ISO-8601 timestamp of the fix. */
  time: string;
  /** Ground speed in m/s, when available. */
  speed?: number;
  /** Horizontal accuracy in metres (snap gates on this — NAVIGATION_SPEC §2). */
  accuracy?: number;
  /** Heading in degrees (0..360), when available. */
  heading?: number;
}

export interface FixSource {
  /** Begin emitting fixes to `onFix`; `onError` receives permission/position/timeout failures.
   *  start() implies a stop() of any prior stream, so re-starting is safe. */
  start(onFix: (fix: Fix) => void, onError?: (error: Error) => void): void;
  /** Stop emitting and release resources. */
  stop(): void;
}
