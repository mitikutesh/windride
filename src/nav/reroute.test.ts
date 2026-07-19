import { describe, expect, it } from 'vitest';
import type { CandidateRoute } from '../domain';
import type { CandidateAnalysis, SegmentAnalysis } from '../engine/scoring';
import { DEFAULT_SPEED_SETTINGS } from '../engine/speedModel';
import type { Rerouter } from './offRoute';
import { attemptReroute, reanalyzeReroute, referenceWind } from './reroute';
import type { RideController } from './rideController';

/** A one-segment analysis with known wind, for the reference-wind reconstruction. */
function analysisWith(exposure: number): CandidateAnalysis {
  const seg: SegmentAnalysis = {
    seg: { a: { lat: 60, lon: 24 }, b: { lat: 60, lon: 24 }, lengthM: 1000, exposure },
    wind: { effectiveMs: 8, windToDeg: 45, gustEffMs: 12 },
    precipProb: 20,
    speedKmh: 25,
    timeS: 144,
    startS: 0,
    hourIndex: 0,
  } as unknown as SegmentAnalysis;
  return {
    segments: [seg],
    candidate: { polyline: [] },
    totalTimeS: 144,
  } as unknown as CandidateAnalysis;
}

function line(id: string): CandidateRoute {
  return {
    id,
    polyline: [
      { lat: 60, lon: 24 },
      { lat: 60.01, lon: 24 },
    ],
    segments: [
      {
        a: { lat: 60, lon: 24 },
        b: { lat: 60.01, lon: 24 },
        lengthM: 1000,
        bearingDeg: 0,
        gradePct: 0,
        surface: 'paved',
        exposure: 1,
      },
    ],
    distanceM: 1000,
    ascentM: 0,
  };
}

describe('referenceWind', () => {
  it('reconstructs raw wind from an analysis (undo exposure, wind_to → wind_from)', () => {
    const w = referenceWind(analysisWith(0.5));
    expect(w.windMs).toBeCloseTo(16, 6); // effectiveMs 8 / exposure 0.5
    expect(w.windFromDeg).toBe(225); // (windTo 45 + 180) % 360
    expect(w.gustMs).toBeCloseTo(24, 6); // gustEff 12 / 0.5
    expect(w.precipProb).toBe(20);
  });
  it('is calm for an empty analysis', () => {
    expect(referenceWind({ segments: [] } as unknown as CandidateAnalysis).windMs).toBe(0);
  });
});

describe('reanalyzeReroute', () => {
  it('produces a wind-analysed analysis for the spliced geometry', () => {
    const out = reanalyzeReroute(line('spliced'), analysisWith(1), DEFAULT_SPEED_SETTINGS);
    expect(out.segments).toHaveLength(1);
    expect(out.totalTimeS).toBeGreaterThan(0);
    expect(out.segments[0].wind).toBeDefined();
    expect(out.candidate.id).toBe('spliced');
  });
});

describe('attemptReroute', () => {
  const ref = analysisWith(1);
  const speed = DEFAULT_SPEED_SETTINGS;
  const inputs = {
    current: { lat: 60, lon: 24 },
    route: line('orig'),
    track: {} as never,
    progressM: 100,
  };
  function fakeController(ri: typeof inputs | null) {
    const applied: CandidateAnalysis[] = [];
    return {
      rerouteInputs: () => ri,
      applyReroute: (a: CandidateAnalysis) => applied.push(a),
      applied,
    } as unknown as RideController & { applied: CandidateAnalysis[] };
  }
  const rerouter = (attempt: () => Promise<unknown>) => ({ attempt }) as unknown as Rerouter;

  it('applies a re-analysed route on a successful reroute', async () => {
    const ctrl = fakeController(inputs);
    const r = await attemptReroute(
      rerouter(async () => ({ ok: true, route: line('spliced'), rejoinAtM: 600 })),
      ctrl,
      ref,
      speed,
    );
    expect(r.result).toBe('rerouted');
    expect(ctrl.applied).toHaveLength(1);
    expect(ctrl.applied[0].candidate.id).toBe('spliced'); // the swapped-in route
  });

  it('reports near-finish without applying anything', async () => {
    const ctrl = fakeController(inputs);
    const r = await attemptReroute(
      rerouter(async () => ({ ok: false, reason: 'near-finish' })),
      ctrl,
      ref,
      speed,
    );
    expect(r.result).toBe('near-finish');
    expect(ctrl.applied).toHaveLength(0);
  });

  it('reports failure with the backoff delay', async () => {
    const r = await attemptReroute(
      rerouter(async () => ({
        ok: false,
        reason: 'provider-error',
        error: new Error('x'),
        nextRetryMs: 4000,
      })),
      fakeController(inputs),
      ref,
      speed,
    );
    expect(r).toEqual({ result: 'failed', nextRetryMs: 4000 });
  });

  it('skips before the first fix (no inputs)', async () => {
    const r = await attemptReroute(
      rerouter(async () => {
        throw new Error('must not be called');
      }),
      fakeController(null),
      ref,
      speed,
    );
    expect(r.result).toBe('skipped');
  });
});
