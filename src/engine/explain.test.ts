import { describe, expect, it } from 'vitest';
import type { CandidateRoute, Segment, WindSample } from '../domain';
import { formatDuration } from './explain';
import { scoreCandidates, type CandidateWindInput } from './scoring';

function candidate(id: string, bearingDeg: number, n = 10): CandidateRoute {
  const seg: Segment = {
    a: { lat: 60, lon: 24 },
    b: { lat: 60, lon: 24 },
    lengthM: 1000,
    bearingDeg,
    gradePct: 0,
    surface: 'paved',
    exposure: 1,
  };
  return {
    id,
    polyline: [
      { lat: 60, lon: 24 },
      { lat: 60.1, lon: 24.1 },
    ],
    segments: Array.from({ length: n }, () => ({ ...seg })),
    distanceM: n * 1000,
    ascentM: 0,
    steps: [],
  };
}
function steadyWind(n: number): WindSample[][] {
  const s: WindSample = {
    windMs: 8,
    windFromDeg: 225,
    gustMs: 12,
    precipProb: 10,
    tempC: 17,
    time: '2026-07-10T17:00',
  };
  return Array.from({ length: n }, () => [s, s, s]);
}

describe('formatDuration', () => {
  it('formats seconds as h:mm', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(8040)).toBe('2:14');
  });
});

describe('explainCandidate (via scoreCandidates)', () => {
  const inputs: CandidateWindInput[] = [
    { candidate: candidate('A', 45), windBySegment: steadyWind(10) }, // tailwind
    { candidate: candidate('B', 225), windBySegment: steadyWind(10) }, // headwind
    { candidate: candidate('C', 135), windBySegment: steadyWind(10) }, // crosswind
  ];
  const { ranked } = scoreCandidates(inputs, { targetDistanceM: 10_000 });

  it('every explanation leads with the distance + wind-aware ETA and contains numbers', () => {
    for (const r of ranked) {
      expect(r.explanation).toMatch(/km, wind-aware ETA \d+:\d\d/);
      expect(r.explanation).toMatch(/\d/); // at least one number (guaranteed by headline)
      expect(r.explanation.endsWith('.')).toBe(true);
    }
  });

  it('reports the headwind route as having direct headwind km', () => {
    const b = ranked.find((r) => r.candidate.id === 'B')!;
    expect(b.explanation).toMatch(/km of direct headwind/);
  });

  it('flags the crosswind route as gust-exposed', () => {
    const c = ranked.find((r) => r.candidate.id === 'C')!;
    expect(c.explanation).toMatch(/exposed to gusts up to \d+ m\/s/);
  });
});
