/**
 * state/plan/runDownwindPlan.ts — the downwind one-way pipeline (WR-026, PRODUCT_SPEC §1 lever 5).
 *
 * wind at start ⇒ downwind arc ⇒ stations in the arc ⇒ pointToPoint route to each ⇒ one-way scoring
 * (sequencing off) ⇒ Digitransit return service at the ETA ⇒ rank = tailwindShare × frequencyFactor.
 * With no Digitransit key the rank falls back to tailwind alone and the card says "check return
 * times". Stores call adapters; the arc math + ranking stay pure in engine/downwind.ts.
 */
import type { TransitProvider } from '../../adapters/transit/digitransit';
import type { Providers } from '../../adapters/registry';
import { exposureAt, loadExposureGrid, type DecodedGrid } from '../../data/exposureGrid';
import { loadStations } from '../../data/stations';
import type { LatLon } from '../../domain';
import {
  downwindEndpoints,
  frequencyFactor,
  rankDownwind,
  tailwindTimeShare,
  type DownwindEndpoint,
  type Station,
} from '../../engine/downwind';
import { resample, segmentMidpoint } from '../../engine/geometry';
import { DEFAULT_WEIGHTS, scoreCandidates, type ScoredCandidate } from '../../engine/scoring';
import { activeSpeedSettings } from '../calibrationStore';
import { orsProfile } from './profiles';

export interface DownwindInputs {
  start: LatLon;
  distanceKm: number;
  surface: 'road' | 'gravel';
  /** Departure hour offset from now (0 = now). The wind at THIS hour picks the downwind stations. */
  departureHour?: number;
}

export interface ReturnInfo {
  departuresMs: number[];
  headwayMin: number | null;
  frequencyFactor: number;
  /** Human return copy, e.g. "trains every ~30 min from 18:40 · bike space not guaranteed". */
  label: string;
}

export interface DownwindResult {
  scored: ScoredCandidate;
  endpoint: DownwindEndpoint;
  tailwindShare: number;
  /** null in no-key mode — the rank then falls back to tailwind share alone. */
  return: ReturnInfo | null;
  rank: number;
}

export interface RunDownwindOpts {
  now: number;
  transit?: TransitProvider;
  loadGrid?: () => Promise<DecodedGrid | null>;
  stations?: Station[];
}

const clock = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function returnLabel(
  station: Station,
  info: { headwayMin: number | null; departuresMs: number[] },
) {
  const mode = station.modes.includes('rail') ? 'trains' : 'buses';
  if (info.headwayMin === null || info.departuresMs.length === 0) {
    return `${mode} back — check return times · bike space not guaranteed`;
  }
  const every = Math.round(info.headwayMin);
  return `${mode} every ~${every} min from ${clock(info.departuresMs[0])} · bike space not guaranteed`;
}

function forecastHours(distanceKm: number): number {
  return Math.max(6, Math.min(24, Math.ceil(distanceKm / 12) + 2));
}

export async function runDownwindPlan(
  providers: Providers,
  inputs: DownwindInputs,
  opts: RunDownwindOpts,
): Promise<DownwindResult[]> {
  const lengthM = inputs.distanceKm * 1000;
  const profile = orsProfile(inputs.surface);
  const stations = opts.stations ?? loadStations();

  // Wind at the DEPARTURE hour fixes the downwind direction (wind_to = wind_from + 180) — an evening
  // ride is planned against the evening wind, not now's.
  const departureHour = Math.max(0, inputs.departureHour ?? 0);
  const hours = forecastHours(inputs.distanceKm);
  const hourly = (await providers.weather.windAlong([inputs.start], hours))[0] ?? [];
  const startHour = Math.min(departureHour, Math.max(0, hourly.length - 1));
  const windFromDeg = hourly[startHour]?.windFromDeg ?? 0;
  const windToDeg = (windFromDeg + 180) % 360;

  const endpoints = downwindEndpoints(inputs.start, stations, { targetM: lengthM, windToDeg });
  if (endpoints.length === 0) return [];

  // Route to each endpoint (out-and-back rejoin geometry is fine — we ride it one way).
  const grid = await (opts.loadGrid ?? loadExposureGrid)();
  const routed = await Promise.all(
    endpoints.map(async (endpoint) => {
      const to = { lat: endpoint.station.lat, lon: endpoint.station.lon };
      const route = await providers.routing.pointToPoint(inputs.start, to, profile);
      const candidate = route.segments.length > 0 ? route : { ...route, segments: resample(route) };
      for (const s of candidate.segments) {
        const mid = segmentMidpoint(s);
        s.exposure = exposureAt(grid, mid.lat, mid.lon).factor;
      }
      return { endpoint, candidate };
    }),
  );

  // One-way scoring: Sequencing off (there's no "get the headwind over with" on a one-way); keep
  // DistanceMatch but with a wide tolerance since road distance exceeds the crow-flies arc filter.
  const { ranked } = scoreCandidates(
    routed.map(({ candidate }) => ({
      candidate,
      windBySegment: candidate.segments.map(() => hourly),
    })),
    {
      targetDistanceM: lengthM,
      prefersSurface: inputs.surface === 'gravel' ? 'gravel' : 'paved',
      weights: { ...DEFAULT_WEIGHTS, sequencing: 0 },
      distanceTolerancePct: 0.4,
      speed: activeSpeedSettings(),
      startHourIndex: startHour, // sample wind from the departure hour, as the arc selection did
    },
  );

  // The ride departs at the chosen hour and takes totalTimeS — the return is caught at that ETA.
  const departAtMs = opts.now + departureHour * 3_600_000;

  const endpointByCandidate = new Map(routed.map((r) => [r.candidate.id, r.endpoint]));
  const results: DownwindResult[] = [];
  for (const scored of ranked) {
    const endpoint = endpointByCandidate.get(scored.candidate.id);
    if (!endpoint) continue;
    const tailwindShare = tailwindTimeShare(scored.analysis);
    const etaMs = departAtMs + scored.analysis.totalTimeS * 1000;

    let ret: ReturnInfo | null = null;
    if (opts.transit) {
      try {
        const svc = await opts.transit.returnService(endpoint.station, etaMs);
        // A single known departure has an unknown headway but still IS a return — treat it as sparse
        // (freq of a ~2 h cadence) rather than 0, so it doesn't sink below a no-service station.
        const ff =
          svc.headwayMin !== null
            ? frequencyFactor(svc.headwayMin)
            : svc.departuresMs.length > 0
              ? frequencyFactor(120)
              : 0;
        ret = {
          departuresMs: svc.departuresMs,
          headwayMin: svc.headwayMin,
          frequencyFactor: ff,
          label: returnLabel(endpoint.station, svc),
        };
      } catch {
        ret = null; // no-key or transient failure ⇒ wind-only ranking for this endpoint
      }
    }

    // With return service, rank by tailwind × frequency; without it, by tailwind alone (§ no-key).
    const rank = ret ? rankDownwind(tailwindShare, ret.frequencyFactor) : tailwindShare;
    results.push({ scored, endpoint, tailwindShare, return: ret, rank });
  }

  return results.sort(
    (a, b) => b.rank - a.rank || a.endpoint.station.id.localeCompare(b.endpoint.station.id),
  );
}
