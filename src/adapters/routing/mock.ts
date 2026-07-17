// adapters/routing/mock.ts — deterministic, zero-network RouteProvider (WR-003).
// Turn steps + ascent come from the ORS fixture; the polyline is synthesized as a CLOSED loop
// that starts at the requested start, is sized to the requested length, and varies by seed so
// candidates are geometrically distinct (real ORS geometry arrives in WR-005).
import orsSampleRaw from '../../../fixtures/ors-roundtrip-sample.geojson?raw';
import type { CandidateRoute, LatLon, RoundTripParams, TurnStep } from '../../domain';
import { ProviderError, type ProviderErrorKind } from '../errors';
import type { RouteProvider } from './index';

export interface MockRouteOptions {
  failWith?: ProviderErrorKind;
}

type OrsGeoJson = {
  features: Array<{
    properties: {
      summary: { distance: number; duration: number; ascent: number; descent: number };
      segments: Array<{
        steps: Array<{
          distance: number;
          duration: number;
          type: number;
          instruction: string;
          way_points: [number, number];
        }>;
      }>;
    };
    geometry: { coordinates: Array<[number, number, number?]> };
  }>;
};
const FIXTURE = JSON.parse(orsSampleRaw) as OrsGeoJson;

function baseFeature() {
  return FIXTURE.features[0];
}

function stepsFromFixture(): TurnStep[] {
  return baseFeature().properties.segments.flatMap((seg) =>
    seg.steps.map((s) => ({
      instruction: s.instruction,
      distanceM: s.distance,
      durationS: s.duration,
      type: s.type,
      wayPoints: s.way_points,
    })),
  );
}

const M_PER_DEG_LAT = 111_320;

/** Rough great-circle distance (equirectangular approx) — adapters may do their own light math. */
function roughMeters(a: LatLon, b: LatLon): number {
  const meanLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const x = (b.lon - a.lon) * (Math.PI / 180) * Math.cos(meanLat) * 6_371_000;
  const y = (b.lat - a.lat) * (Math.PI / 180) * 6_371_000;
  return Math.hypot(x, y);
}

function polylineLengthM(pts: LatLon[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += roughMeters(pts[i - 1], pts[i]);
  return sum;
}

/**
 * A closed loop of ~`lengthM` circumference whose first (and last) vertex is exactly `start`.
 * Ellipse aspect + rotation are seed-derived so different seeds give distinct shapes.
 */
function loopPolyline(start: LatLon, lengthM: number, seed: number): LatLon[] {
  const N = 24;
  const radiusM = lengthM / (2 * Math.PI);
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((start.lat * Math.PI) / 180);
  const aspect = 1 + 0.35 * Math.sin(seed * 1.7);
  const rot = seed * 0.9;

  const raw = Array.from({ length: N + 1 }, (_v, i) => {
    const t = (i / N) * 2 * Math.PI;
    return { x: radiusM * aspect * Math.cos(t + rot), y: radiusM * Math.sin(t + rot) };
  });
  // Translate so vertex 0 lands on `start`; vertex N == vertex 0, so the loop is closed.
  const dx = raw[0].x;
  const dy = raw[0].y;
  return raw.map((p) => ({
    lat: start.lat + (p.y - dy) / M_PER_DEG_LAT,
    lon: start.lon + (p.x - dx) / mPerDegLon,
  }));
}

export class MockRouteProvider implements RouteProvider {
  private readonly failWith?: ProviderErrorKind;

  constructor(opts: MockRouteOptions = {}) {
    this.failWith = opts.failWith;
  }

  async roundTrip(p: RoundTripParams): Promise<CandidateRoute> {
    if (this.failWith) throw new ProviderError(this.failWith);
    const polyline = loopPolyline(p.start, p.lengthM, p.seed);
    return {
      id: `mock-rt-${p.seed}-${p.points}`,
      polyline,
      segments: [], // geometry engine (WR-006) resamples the polyline into segments
      distanceM: polylineLengthM(polyline), // consistent with the polyline (≈ requested length)
      ascentM: baseFeature().properties.summary.ascent,
      steps: stepsFromFixture(),
    };
  }

  async pointToPoint(a: LatLon, b: LatLon, _profile: string): Promise<CandidateRoute> {
    if (this.failWith) throw new ProviderError(this.failWith);
    const polyline: LatLon[] = [a, b];
    return {
      id: `mock-p2p-${a.lat.toFixed(4)},${a.lon.toFixed(4)}-${b.lat.toFixed(4)},${b.lon.toFixed(4)}`,
      polyline,
      segments: [],
      distanceM: roughMeters(a, b),
      ascentM: 0,
    };
  }
}
