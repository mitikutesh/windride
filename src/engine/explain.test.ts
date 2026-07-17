import { describe, expect, it } from 'vitest';
import type { CandidateRoute, Segment, WindSample } from '../domain';
import { explainCandidate, formatDuration } from './explain';
import {
  scoreCandidates,
  type CandidateWindInput,
  type Evidence,
  type ScoredCandidate,
  type SubScoreName,
} from './scoring';

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

// Directly exercise the surface/scenery/climb templates (low-priority facts that the golden
// ranking rarely surfaces) by handing explainCandidate a candidate whose only notable facts
// are those. All sub-scores neutral so wind never outranks them.
function scoredWith(evidence: Partial<Evidence>): ScoredCandidate {
  const sub = {} as ScoredCandidate['sub'];
  for (const n of [
    'wind',
    'safety',
    'shelter',
    'surface',
    'traffic',
    'scenery',
    'climb',
    'distance',
    'rain',
    'sequencing',
  ] as SubScoreName[]) {
    sub[n] = { normalized: 0, raw: 0 };
  }
  const full: Evidence = {
    distanceKm: 30,
    timeS: 3600,
    ascentM: 0,
    directHeadwindKm: 0,
    headwindKm: 0,
    tailwindKm: 0,
    tailwindFinishKm: 0,
    gravelKm: 0,
    greenerKm: 0,
    gustyKm: 0,
    maxGustMs: 0,
    headwindFirstHalfShare: 0.5,
    shelteredUpwindKm: 0,
    shelteredEffWindMs: 0,
    ...evidence,
  };
  const c = candidate('x', 45);
  return {
    candidate: c,
    analysis: {
      candidate: c,
      segments: [],
      totalTimeS: full.timeS,
      distanceM: full.distanceKm * 1000,
      ascentM: full.ascentM,
      hasFerry: false,
    },
    total: 50,
    sub,
    evidence: full,
    rank: 1,
    explanation: '',
  };
}

describe('explainCandidate — surface/scenery/climb templates', () => {
  it('reports gravel distance', () => {
    const sc = scoredWith({ gravelKm: 8 });
    expect(explainCandidate(sc, [sc])).toMatch(/8\.0 km on gravel/);
  });
  it('reports path/cycleway distance', () => {
    const sc = scoredWith({ greenerKm: 6 });
    expect(explainCandidate(sc, [sc])).toMatch(/6\.0 km on paths and cycleways/);
  });
  it('reports climbing metres and capitalises each sentence', () => {
    const sc = scoredWith({ ascentM: 250 });
    const text = explainCandidate(sc, [sc]);
    expect(text).toMatch(/250 m of climbing/);
    expect(text).toMatch(/\. [A-Z0-9]/); // each sentence starts capitalised
  });

  it('reports sheltered upwind km with the effective wind (WR-019)', () => {
    const c = candidate('SH', 225); // headwind (bearing 225 into a SW wind)
    c.segments = c.segments.map((s) => ({ ...s, exposure: 0.35 }));
    const { ranked } = scoreCandidates([{ candidate: c, windBySegment: steadyWind(10) }], {
      targetDistanceM: 10_000,
    });
    expect(ranked[0].explanation).toMatch(/km of upwind inside forest, effective wind [\d.]+ m\/s/);
  });
});
