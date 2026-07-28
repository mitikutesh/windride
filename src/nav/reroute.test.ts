import { describe, expect, it } from 'vitest';
import type { CandidateRoute } from '../domain';
import type { CandidateAnalysis, SegmentAnalysis } from '../engine/scoring';
import { DEFAULT_SPEED_SETTINGS } from '../engine/speedModel';
import type { Rerouter } from './offRoute';
import { proposeReroute, reanalyzeReroute, referenceWind } from './reroute';
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
  it('recovers wind from the least-sheltered segment, not a becalmed segment[0]', () => {
    // segment[0] is fully sheltered (exposure 0 → effectiveMs 0): dividing there yields calm and
    // would poison the whole reroute. A later exposed segment carries the real wind.
    const sheltered: SegmentAnalysis = {
      seg: { a: { lat: 60, lon: 24 }, b: { lat: 60, lon: 24 }, lengthM: 500, exposure: 0 },
      wind: { effectiveMs: 0, windToDeg: 45, gustEffMs: 0 },
      precipProb: 20,
    } as unknown as SegmentAnalysis;
    const exposed = analysisWith(1).segments[0]; // effectiveMs 8, exposure 1
    const w = referenceWind({
      segments: [sheltered, exposed],
    } as unknown as CandidateAnalysis);
    expect(w.windMs).toBeCloseTo(8, 6); // from the exposed segment, not the becalmed first one
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

describe('proposeReroute', () => {
  const ref = analysisWith(1);
  const speed = DEFAULT_SPEED_SETTINGS;
  const inputs = {
    current: { lat: 60, lon: 24 },
    route: line('orig'),
    track: { total: 1000 } as never,
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

  it('returns a re-analysed proposal WITHOUT applying it (confirm flow — WR-051)', async () => {
    const ctrl = fakeController(inputs);
    const r = await proposeReroute(
      rerouter(async () => ({ ok: true, route: line('spliced'), rejoinAtM: 600 })),
      ctrl,
      ref,
      speed,
    );
    expect(r.result).toBe('proposed');
    if (r.result !== 'proposed') throw new Error('unreachable');
    expect(r.proposal.analysis.candidate.id).toBe('spliced'); // ready to apply on Accept
    expect(r.proposal.rejoinAtM).toBe(600); // rejoins the ORIGINAL route downstream
    expect(ctrl.applied).toHaveLength(0); // nothing swapped without the rider's Accept
  });

  it('previewPolyline covers only the detour leg, not the whole spliced route', async () => {
    // Spliced route: 1000 m advertised, original tail beyond the rejoin = 1000 − 600 = 400 m,
    // so the fetched leg ends 600 m along the spliced polyline — the preview must stop there.
    const r = await proposeReroute(
      rerouter(async () => ({ ok: true, route: line('spliced'), rejoinAtM: 600 })),
      fakeController(inputs),
      ref,
      speed,
    );
    if (r.result !== 'proposed') throw new Error('expected a proposal');
    const preview = r.proposal.previewPolyline;
    const full = line('spliced').polyline;
    expect(preview[0]).toEqual(full[0]); // starts at the rider
    const last = preview[preview.length - 1];
    expect(last.lat).toBeGreaterThan(full[0].lat); // reaches forward…
    expect(last.lat).toBeLessThan(full[full.length - 1].lat); // …but stops before the finish
  });

  it('reports near-finish without proposing anything', async () => {
    const ctrl = fakeController(inputs);
    const r = await proposeReroute(
      rerouter(async () => ({ ok: false, reason: 'near-finish' })),
      ctrl,
      ref,
      speed,
    );
    expect(r.result).toBe('near-finish');
    expect(ctrl.applied).toHaveLength(0);
  });

  it('reports failure with the backoff delay', async () => {
    const r = await proposeReroute(
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
    const r = await proposeReroute(
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
