import { describe, expect, it } from 'vitest';
import type { CandidateRoute, Segment, WindSample } from '../domain';
import { DEFAULT_WEIGHTS, scoreCandidates, type CandidateWindInput } from '../engine/scoring';
import { DEFAULT_ACCEPT_CONFIG, runAcceptance } from './acceptance';

describe('v0.1 acceptance harness (PRODUCT_SPEC §6)', () => {
  it('passes every check for 30/50/80 km on the SW-8 m/s fixture, under 10 s', async () => {
    const report = await runAcceptance();
    for (const r of report.results) {
      for (const c of r.checks) {
        expect(c.pass, `${r.distanceKm} km: ${c.name} — ${c.detail}`).toBe(true);
      }
    }
    expect(report.elapsedMs).toBeLessThan(DEFAULT_ACCEPT_CONFIG.wallClockMs);
    expect(report.pass).toBe(true);
  });
});

// Intentional regression: prove the WindComfort sub-score is actually wired into the ranking by
// showing that doubling its weight flips the winner in a hand-built near-tie fixture.
function seg(bearingDeg: number, surface: Segment['surface'], wayClass: string): Segment {
  return {
    a: { lat: 60, lon: 24 },
    b: { lat: 60, lon: 24 },
    lengthM: 1000,
    bearingDeg,
    gradePct: 0,
    surface,
    wayClass,
    exposure: 1,
  };
}
function cand(
  id: string,
  bearingDeg: number,
  n: number,
  surface: Segment['surface'],
  wayClass: string,
  ascentM: number,
): CandidateRoute {
  return {
    id,
    polyline: [
      { lat: 60, lon: 24 },
      { lat: 60.05, lon: 24.05 },
    ],
    segments: Array.from({ length: n }, () => seg(bearingDeg, surface, wayClass)),
    distanceM: n * 1000,
    ascentM,
    steps: [],
  };
}
function steady(n: number): WindSample[][] {
  const s: WindSample = {
    windMs: 8,
    windFromDeg: 225,
    gustMs: 12,
    precipProb: 0,
    tempC: 17,
    time: '2026-07-10T17:00',
  };
  return Array.from({ length: n }, () => [s, s, s]);
}

describe('intentional regression (guards against dead wind wiring)', () => {
  it('doubling the WindComfort weight flips the winner', () => {
    // Hi: headwind (poor wind) but best surface/scenery/distance/climb; Lo: tailwind (best wind)
    // but worst on the rest. Baseline: Hi wins on the pile of small weights; double wind -> Lo.
    const inputs: CandidateWindInput[] = [
      { candidate: cand('Lo', 45, 9, 'gravel', 'road', 0), windBySegment: steady(9) },
      { candidate: cand('Hi', 225, 10, 'paved', 'cycleway', 300), windBySegment: steady(10) },
    ];
    const opts = { targetDistanceM: 10_000, targetAscentM: 300, prefersSurface: 'paved' as const };

    const base = scoreCandidates(inputs, opts);
    const doubled = scoreCandidates(inputs, {
      ...opts,
      weights: { ...DEFAULT_WEIGHTS, wind: DEFAULT_WEIGHTS.wind * 2 },
    });

    expect(base.ranked[0].candidate.id).toBe('Hi');
    expect(doubled.ranked[0].candidate.id).toBe('Lo');
  });
});
