import { describe, expect, it } from 'vitest';
import realEspooRaw from '../../../fixtures/openmeteo/real-espoo.json?raw';
import type { LatLon } from '../../domain';
import type { ProviderErrorKind } from '../errors';
import { describeWeatherProviderContract } from '../providerContract';
import { OpenMeteoProvider } from './openMeteo';

const FIXTURE = JSON.parse(realEspooRaw);
const FIXED_NOW = 1_700_000_000_000;
const POINTS: LatLon[] = [
  { lat: 60.17, lon: 24.65 },
  { lat: 60.25, lon: 24.75 },
  { lat: 60.2, lon: 24.55 },
];

function okFetch(onUrl?: (url: string) => void): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    onUrl?.(String(input));
    return { ok: true, status: 200, json: async () => FIXTURE } as Response;
  }) as unknown as typeof fetch;
}

function failFetch(kind: ProviderErrorKind): typeof fetch {
  if (kind === 'network') {
    return (async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
  }
  const status = kind === 'quota' ? 429 : 500;
  return (async () =>
    ({ ok: false, status, json: async () => ({}) }) as Response) as unknown as typeof fetch;
}

// The WR-003 contract, re-run against the REAL adapter in fixture mode.
describeWeatherProviderContract(
  'OpenMeteoProvider (fixture mode)',
  () => new OpenMeteoProvider({ fetchFn: okFetch(), now: () => FIXED_NOW }),
  (kind) => new OpenMeteoProvider({ fetchFn: failFetch(kind), now: () => FIXED_NOW }),
);

describe('OpenMeteoProvider parsing (captured fixture)', () => {
  it('parses point0 hour0 with hand-checked values (wind FROM 134°)', async () => {
    const grid = await new OpenMeteoProvider({
      fetchFn: okFetch(),
      now: () => FIXED_NOW,
    }).windAlong(POINTS, 6);
    expect(grid[0][0]).toEqual({
      windMs: 1.7,
      windFromDeg: 134,
      gustMs: 3.2,
      precipProb: 0,
      tempC: 16.8,
      time: '2026-07-17T00:00',
    });
  });

  it('returns a [pointIdx][hourIdx] grid (3x6), never transposed', async () => {
    const grid = await new OpenMeteoProvider({
      fetchFn: okFetch(),
      now: () => FIXED_NOW,
    }).windAlong(POINTS, 6);
    expect(grid).toHaveLength(3);
    for (const perPoint of grid) expect(perPoint).toHaveLength(6);
  });

  it('reads daylight from the daily fields', async () => {
    const d = await new OpenMeteoProvider({ fetchFn: okFetch(), now: () => FIXED_NOW }).daylight(
      POINTS[0],
    );
    expect(d).toEqual({ sunrise: '2026-07-17T04:26', sunset: '2026-07-17T22:27' });
  });

  it('builds the URL with the API_NOTES §1 params', async () => {
    let seen = '';
    await new OpenMeteoProvider({
      fetchFn: okFetch((u) => (seen = u)),
      now: () => FIXED_NOW,
    }).windAlong(POINTS, 6);
    expect(seen).toContain('wind_speed_unit=ms');
    expect(seen).toContain('timezone=auto');
    expect(seen).toContain('wind_speed_10m');
    expect(seen).toContain('latitude=60.17');
  });
});

describe('OpenMeteoProvider cache', () => {
  it('serves the second identical call from cache (zero extra fetches)', async () => {
    let calls = 0;
    const counting = okFetch(() => {
      calls++;
    });
    const provider = new OpenMeteoProvider({ fetchFn: counting, now: () => FIXED_NOW });
    await provider.windAlong(POINTS, 6);
    await provider.windAlong(POINTS, 6);
    expect(calls).toBe(1);
  });
});
