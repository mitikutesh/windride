// adapters/routing/mock.ts — deterministic, zero-network RouteProvider (WR-003).
// Fixture-fed from the ORS round-trip sample; varies geometry by seed so candidates differ.
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

// Deterministic seed jitter so different seeds yield geometrically distinct polylines.
function jitter(seed: number, i: number, axis: number): number {
  return Math.sin(seed * 1.3 + i * 0.21 + axis * 1.7) * 0.002;
}

/** Rough great-circle distance (equirectangular approx) — adapters may do their own light math. */
function roughMeters(a: LatLon, b: LatLon): number {
  const R = 6_371_000;
  const meanLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const x = (b.lon - a.lon) * (Math.PI / 180) * Math.cos(meanLat);
  const y = (b.lat - a.lat) * (Math.PI / 180);
  return Math.sqrt(x * x + y * y) * R;
}

export class MockRouteProvider implements RouteProvider {
  private readonly failWith?: ProviderErrorKind;

  constructor(opts: MockRouteOptions = {}) {
    this.failWith = opts.failWith;
  }

  async roundTrip(p: RoundTripParams): Promise<CandidateRoute> {
    if (this.failWith) throw new ProviderError(this.failWith);
    const coords = baseFeature().geometry.coordinates;
    const polyline: LatLon[] = coords.map(([lon, lat], i) => ({
      lat: lat + jitter(p.seed, i, 0),
      lon: lon + jitter(p.seed, i, 1),
    }));
    return {
      id: `mock-rt-${p.seed}-${p.points}`,
      polyline,
      segments: [], // geometry engine (WR-006) resamples the polyline into segments
      distanceM: p.lengthM, // mock honours the requested length; real geometry lands in WR-005
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
