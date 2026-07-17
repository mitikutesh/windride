import { describe, expect, it } from 'vitest';
import realEspooRaw from '../../../fixtures/openmeteo/real-espoo.json?raw';
import type { LatLon } from '../../domain';
import type { ProviderErrorKind } from '../errors';
import { describeWeatherProviderContract } from '../providerContract';
import { OpenMeteoProvider, parseDaylight, parseRecentPrecipMm, parseWindGrid } from './openMeteo';

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
  it('parses point0 hour0 with hand-checked values (wind FROM 166°, current-hour slot)', async () => {
    const grid = await new OpenMeteoProvider({
      fetchFn: okFetch(),
      now: () => FIXED_NOW,
    }).windAlong(POINTS, 6);
    expect(grid[0][0]).toEqual({
      windMs: 3.5,
      windFromDeg: 166,
      gustMs: 8.3,
      precipProb: 0,
      tempC: 22.4,
      feelsC: 22.6,
      time: '2026-07-17T12:00',
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
    expect(seen).toContain('forecast_hours=6'); // next-N-hours window, slot 0 = current hour
  });

  it('parses daylight from a daily-only response (no hourly key)', () => {
    const d = parseDaylight({
      daily: { sunrise: ['2026-07-17T04:26'], sunset: ['2026-07-17T22:27'] },
    });
    expect(d).toEqual({ sunrise: '2026-07-17T04:26', sunset: '2026-07-17T22:27' });
  });

  it('throws badResponse when an hourly field is missing (param-rename guard)', () => {
    expect(() => parseWindGrid([{ hourly: { time: ['2026-07-17T12:00'] } }], 1, 1)).toThrow(
      /missing/,
    );
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

  it('re-fetches after the TTL / date-hour bucket rolls over', async () => {
    let calls = 0;
    let clock = FIXED_NOW;
    const counting = okFetch(() => {
      calls++;
    });
    const provider = new OpenMeteoProvider({ fetchFn: counting, now: () => clock });
    await provider.windAlong(POINTS, 6);
    clock += 31 * 60 * 1000; // past the 30 min TTL (and into the next hour bucket)
    await provider.windAlong(POINTS, 6);
    expect(calls).toBe(2);
  });
});

describe('parseRecentPrecipMm (WR-027)', () => {
  it('sums only the first `hours` past entries (excludes the trailing forecast hour)', () => {
    const body = [{ hourly: { precipitation: [1, 2, 0.5, 99] } }]; // 99 = the +1 forecast hour
    expect(parseRecentPrecipMm(body, 3)).toBeCloseTo(3.5, 6);
  });
  it('treats nulls as 0 and sums the whole array when no window is given', () => {
    expect(parseRecentPrecipMm([{ hourly: { precipitation: [1, null, 2] } }])).toBeCloseTo(3, 6);
  });
  it('accepts a bare (non-array) response object', () => {
    expect(parseRecentPrecipMm({ hourly: { precipitation: [0.4, 0.6] } })).toBeCloseTo(1, 6);
  });
  it('returns 0 for missing/malformed bodies', () => {
    expect(parseRecentPrecipMm({})).toBe(0);
    expect(parseRecentPrecipMm([{ hourly: {} }])).toBe(0);
    expect(parseRecentPrecipMm(null)).toBe(0);
  });
});

describe('OpenMeteoProvider.recentPrecipMm (WR-027)', () => {
  const precipBody = [{ hourly: { precipitation: [...Array(24).fill(0.1), 5] } }]; // 24 past + forecast
  it('sums the prior 24 h of precipitation, not the forecast hour', async () => {
    const fetchFn = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => precipBody,
      }) as Response) as unknown as typeof fetch;
    const p = new OpenMeteoProvider({ fetchFn, now: () => FIXED_NOW });
    expect(await p.recentPrecipMm({ lat: 60.17, lon: 24.65 }, 24)).toBeCloseTo(2.4, 6);
  });
  it('maps a rate-limit to a quota error', async () => {
    const p = new OpenMeteoProvider({ fetchFn: failFetch('quota'), now: () => FIXED_NOW });
    await expect(p.recentPrecipMm({ lat: 60.17, lon: 24.65 }, 24)).rejects.toMatchObject({
      kind: 'quota',
    });
  });
});
