import { describe, expect, it } from 'vitest';
import type { Providers } from '../../adapters/registry';
import { ProviderError } from '../../adapters/errors';
import type { ReturnService, TransitProvider } from '../../adapters/transit/digitransit';
import type { LatLon, WindSample } from '../../domain';
import { haversineM } from '../../engine/geometry';
import type { Station } from '../../engine/downwind';
import { runDownwindPlan } from './runDownwindPlan';

const START: LatLon = { lat: 60.17, lon: 24.94 };
const NOW = Date.parse('2026-07-17T16:00:00Z');

/** Place a station at an exact bearing + distance from START. */
function stationAt(id: string, brgDeg: number, distM: number, modes = ['rail']): Station {
  const R = 6_371_000;
  const d = distM / R;
  const b = (brgDeg * Math.PI) / 180;
  const lat1 = (START.lat * Math.PI) / 180;
  const lon1 = (START.lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { id, name: id, lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI, modes };
}

// SW wind (from 225) ⇒ downwind travel is NE (wind_to 45).
const sample = (): WindSample => ({
  windMs: 8,
  windFromDeg: 225,
  gustMs: 10,
  precipProb: 0,
  tempC: 15,
  time: '2026-07-17T16:00',
});

function providers(): Providers {
  return {
    weather: {
      windAlong: async (points: LatLon[], hours: number) =>
        points.map(() => Array.from({ length: hours }, sample)),
      daylight: async () => ({ sunrise: '2026-07-17T04:00', sunset: '2026-07-17T22:00' }),
    },
    routing: {
      roundTrip: async () => {
        throw new Error('unused in downwind');
      },
      pointToPoint: async (a: LatLon, b: LatLon) => ({
        id: `to-${b.lat.toFixed(3)}-${b.lon.toFixed(3)}`,
        polyline: [a, b],
        segments: [],
        distanceM: haversineM(a, b),
        ascentM: 0,
      }),
    },
  } as unknown as Providers;
}

const noGrid = async () => null;

// FREQ station: dead downwind, frequent trains. RARE: also downwind (in arc) but sparse trains.
const FREQ = stationAt('freq', 45, 52_000);
const RARE = stationAt('rare', 60, 50_000);
const CROSS = stationAt('cross', 130, 50_000); // out of the downwind arc — must be filtered out

function transit(headwayById: Record<string, number>): TransitProvider {
  return {
    returnService: async (station, afterMs): Promise<ReturnService> => {
      // Match the station by proximity (the planner passes lat/lon only).
      const id =
        haversineM(station, FREQ) < 200 ? 'freq' : haversineM(station, RARE) < 200 ? 'rare' : '?';
      const headwayMin = headwayById[id];
      return {
        departuresMs: [afterMs + 5 * 60_000, afterMs + (5 + headwayMin) * 60_000],
        headwayMin,
      };
    },
  };
}

describe('runDownwindPlan', () => {
  it('ranks a frequent-return downwind station above a sparse-return one', async () => {
    const results = await runDownwindPlan(
      providers(),
      { start: START, distanceKm: 52, surface: 'road' },
      {
        now: NOW,
        stations: [FREQ, RARE, CROSS],
        loadGrid: noGrid,
        transit: transit({ freq: 15, rare: 90 }),
      },
    );
    // Crosswind station filtered out; both downwind stations kept.
    expect(results.map((r) => r.endpoint.station.id).sort()).toEqual(['freq', 'rare']);
    // Both are pure tailwind (share ≈ 1), so the frequent return wins on frequency factor.
    expect(results[0].endpoint.station.id).toBe('freq');
    expect(results[0].tailwindShare).toBeGreaterThan(0.9);
    expect(results[0].rank).toBeGreaterThan(results[1].rank);
    expect(results[0].return?.label).toMatch(/trains every ~15 min from \d\d:\d\d/);
    expect(results[0].return?.label).toMatch(/bike space not guaranteed/);
  });

  it('degrades to wind-only ranking with no Digitransit key (no return info)', async () => {
    const noKey: TransitProvider = {
      returnService: async () => {
        throw new ProviderError('badResponse', 'Digitransit key missing', 'no-key');
      },
    };
    const results = await runDownwindPlan(
      providers(),
      { start: START, distanceKm: 52, surface: 'road' },
      { now: NOW, stations: [FREQ, RARE], loadGrid: noGrid, transit: noKey },
    );
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.return).toBeNull();
      expect(r.rank).toBeCloseTo(r.tailwindShare, 6); // rank == tailwind share alone
    }
  });

  it('returns nothing when no station sits in the downwind arc', async () => {
    const results = await runDownwindPlan(
      providers(),
      { start: START, distanceKm: 52, surface: 'road' },
      { now: NOW, stations: [CROSS], loadGrid: noGrid, transit: transit({}) },
    );
    expect(results).toEqual([]);
  });
});
