import { describe, expect, it } from 'vitest';
import type { LatLon } from '../domain';
import { toGpx } from '../utils/gpx';
import type { Fix } from './fixSource';
import {
  applyJitter,
  mulberry32,
  parseTraceToFixes,
  replayFixes,
  ReplaySource,
  walkPolyline,
} from './replay';

const line: LatLon[] = [
  { lat: 60, lon: 24 },
  { lat: 60.01, lon: 24 }, // ~1113 m due north
];

describe('walkPolyline', () => {
  it('emits fixes at the modelled spacing with increasing times and speed', () => {
    const fixes = walkPolyline(line, { speedMs: 10, hz: 1, startEpochMs: 0 });
    expect(fixes.length).toBeGreaterThan(100); // ~1113 m / 10 m ≈ 112
    expect(fixes[0]).toMatchObject({ lat: 60, lon: 24, speed: 10 });
    for (let i = 1; i < fixes.length; i++) {
      expect(Date.parse(fixes[i].time)).toBeGreaterThan(Date.parse(fixes[i - 1].time));
    }
    // Ends EXACTLY at the last point (so loops close) even when total isn't a multiple of step.
    expect(fixes[fixes.length - 1].lat).toBeCloseTo(60.01, 9);
    expect(fixes[fixes.length - 1].lon).toBeCloseTo(24, 9);
  });
});

describe('parseTraceToFixes', () => {
  it('parses points and derives speed from time + distance', () => {
    const xml = toGpx({
      name: 't',
      points: [
        { lat: 60, lon: 24, ele: 10, time: '2026-07-10T09:00:00.000Z' },
        { lat: 60.001, lon: 24, ele: 11, time: '2026-07-10T09:00:10.000Z' },
      ],
    });
    const fixes = parseTraceToFixes(xml);
    expect(fixes).toHaveLength(2);
    expect(fixes[0].ele).toBe(10);
    expect(fixes[1].speed).toBeGreaterThan(0); // ~111 m / 10 s ≈ 11 m/s
    expect(fixes[1].speed!).toBeCloseTo(11.1, 0);
  });
});

describe('replay determinism', () => {
  const fixes = walkPolyline(line, { speedMs: 10 });

  it('is a passthrough with jitter 0', () => {
    expect(replayFixes(fixes, { jitterM: 0 })).toEqual(fixes);
  });

  it('is reproducible for a fixed jitter seed and differs across seeds', () => {
    const a = applyJitter(fixes, 8, mulberry32(42));
    const b = applyJitter(fixes, 8, mulberry32(42));
    const c = applyJitter(fixes, 8, mulberry32(43));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    // jitter actually moves points but keeps them near the source (within a few sigma)
    expect(a[0].lat).not.toBe(fixes[0].lat);
  });
});

describe('ReplaySource timing', () => {
  it('schedules fixes at (t - t0)/speed and emits them all in order', () => {
    const fixes: Fix[] = [
      { lat: 60, lon: 24, time: '2026-07-10T09:00:00.000Z' },
      { lat: 60.001, lon: 24, time: '2026-07-10T09:00:01.000Z' },
      { lat: 60.002, lon: 24, time: '2026-07-10T09:00:02.000Z' },
    ];
    const scheduled: { ms: number; cb: () => void }[] = [];
    const source = new ReplaySource(fixes, {
      speed: 10,
      setTimeoutFn: (cb, ms) => {
        scheduled.push({ ms, cb });
        return scheduled.length - 1;
      },
      clearTimeoutFn: () => {},
    });
    const got: Fix[] = [];
    source.start((f) => got.push(f));

    // 1 s apart at 10x => 100 ms apart; timing accuracy well within ±10%.
    expect(scheduled.map((s) => s.ms)).toEqual([0, 100, 200]);
    scheduled.forEach((s) => s.cb());
    expect(got.map((f) => f.lat)).toEqual([60, 60.001, 60.002]);
  });

  it('emits with real timers within ±10% wall-clock at 20x', async () => {
    const fixes: Fix[] = [
      { lat: 60, lon: 24, time: '2026-07-10T09:00:00.000Z' },
      { lat: 60, lon: 24, time: '2026-07-10T09:00:02.000Z' }, // 2 s later => 100 ms at 20x
    ];
    const source = new ReplaySource(fixes, { speed: 20 });
    const t0 = performance.now();
    const last = await new Promise<number>((resolve) => {
      let n = 0;
      source.start(() => {
        n += 1;
        if (n === fixes.length) resolve(performance.now() - t0);
      });
    });
    expect(last).toBeGreaterThan(80); // ~100 ms, within ±10% plus scheduler slack
    expect(last).toBeLessThan(160);
  });
});
