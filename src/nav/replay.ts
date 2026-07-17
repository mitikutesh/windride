/**
 * nav/replay.ts — deterministic simulated GPS (WR-012, NAVIGATION_SPEC §8).
 *
 * Parse/synthesise fixes and stream them through the real nav pipeline at N× speed with optional
 * gaussian jitter. Pure helpers (walk/jitter) are unit-tested; ReplaySource is the FixSource the
 * dev panel and `npm run replay` drive.
 */
import type { LatLon } from '../domain';
import { haversineM } from '../engine/geometry';
import { fromGpx } from '../utils/gpx';
import type { Fix, FixSource } from './fixSource';

const M_PER_DEG_LAT = 111_320;

/** Deterministic PRNG (mulberry32) so jittered traces are reproducible from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard-normal sample from a uniform rng (Box–Muller). */
function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Parse a GPX trace into fixes, deriving speed from consecutive point time+distance. */
export function parseTraceToFixes(xml: string): Fix[] {
  const pts = fromGpx(xml);
  return pts.map((p, i) => {
    const fix: Fix = { lat: p.lat, lon: p.lon, time: p.time ?? new Date(0).toISOString() };
    if (p.ele !== undefined) fix.ele = p.ele;
    if (i > 0 && p.time && pts[i - 1].time) {
      const dt = (Date.parse(p.time) - Date.parse(pts[i - 1].time!)) / 1000;
      if (dt > 0) fix.speed = haversineM(pts[i - 1], p) / dt;
    }
    return fix;
  });
}

export interface WalkOptions {
  /** Ground speed in m/s (default ~25 km/h). */
  speedMs?: number;
  /** Fix rate in Hz (default 1). */
  hz?: number;
  /** Epoch ms of the first fix (default 0, deterministic). */
  startEpochMs?: number;
}

/** Walk a polyline at a modelled speed, emitting fixes at `hz` — the ground truth for snap tests. */
export function walkPolyline(points: LatLon[], opts: WalkOptions = {}): Fix[] {
  const speedMs = opts.speedMs ?? 25 / 3.6;
  const hz = opts.hz ?? 1;
  const start = opts.startEpochMs ?? 0;
  if (points.length < 2) return [];

  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++)
    cum.push(cum[i - 1] + haversineM(points[i - 1], points[i]));
  const total = cum[cum.length - 1];
  const step = speedMs / hz;

  const fixes: Fix[] = [];
  for (let d = 0; d <= total + 1e-6; d += step) {
    const dd = Math.min(d, total);
    let i = 0;
    while (i < cum.length - 1 && cum[i + 1] < dd) i++;
    const span = cum[i + 1] - cum[i] || 1;
    const t = (dd - cum[i]) / span;
    fixes.push({
      lat: points[i].lat + (points[i + 1].lat - points[i].lat) * t,
      lon: points[i].lon + (points[i + 1].lon - points[i].lon) * t,
      time: new Date(start + (dd / speedMs) * 1000).toISOString(),
      speed: speedMs,
    });
  }
  return fixes;
}

/** Add gaussian position noise (metres stddev). Deterministic given a seeded rng. */
export function applyJitter(fixes: Fix[], jitterM: number, rng: () => number): Fix[] {
  if (jitterM <= 0) return fixes.map((f) => ({ ...f }));
  return fixes.map((f) => {
    const mPerDegLon = M_PER_DEG_LAT * Math.cos((f.lat * Math.PI) / 180);
    return {
      ...f,
      lat: f.lat + (gauss(rng) * jitterM) / M_PER_DEG_LAT,
      lon: f.lon + (gauss(rng) * jitterM) / mPerDegLon,
    };
  });
}

export interface ReplayOptions {
  /** Playback speed multiplier (default 1×). */
  speed?: number;
  /** Gaussian jitter stddev in metres (default 0 = deterministic passthrough). */
  jitterM?: number;
  rng?: () => number;
  setTimeoutFn?: (cb: () => void, ms: number) => number;
  clearTimeoutFn?: (id: number) => void;
}

/** Produce the exact fix sequence a replay will emit (no timers) — for determinism tests. */
export function replayFixes(fixes: Fix[], opts: ReplayOptions = {}): Fix[] {
  const jitterM = opts.jitterM ?? 0;
  return applyJitter(fixes, jitterM, opts.rng ?? mulberry32(1));
}

/** A FixSource that streams a fix list with real relative timing, scaled by `speed`. */
export class ReplaySource implements FixSource {
  private readonly fixes: Fix[];
  private readonly speed: number;
  private readonly setTimeoutFn: (cb: () => void, ms: number) => number;
  private readonly clearTimeoutFn: (id: number) => void;
  private timers: number[] = [];

  constructor(fixes: Fix[], opts: ReplayOptions = {}) {
    this.fixes = replayFixes(fixes, opts);
    this.speed = opts.speed ?? 1;
    this.setTimeoutFn = opts.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms) as unknown as number);
    this.clearTimeoutFn = opts.clearTimeoutFn ?? ((id) => clearTimeout(id));
  }

  start(handler: (fix: Fix) => void): void {
    this.stop();
    if (this.fixes.length === 0) return;
    const t0 = Date.parse(this.fixes[0].time);
    for (const fix of this.fixes) {
      const delay = Math.max(0, (Date.parse(fix.time) - t0) / this.speed);
      this.timers.push(this.setTimeoutFn(() => handler(fix), delay));
    }
  }

  stop(): void {
    for (const id of this.timers) this.clearTimeoutFn(id);
    this.timers = [];
  }
}
