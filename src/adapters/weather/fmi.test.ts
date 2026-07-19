import { describe, expect, it } from 'vitest';
import fixtureXml from '../../../fixtures/fmi/forecast-helsinki.xml?raw';
import type { Daylight, LatLon, WindGrid } from '../../domain';
import type { WeatherProvider } from './index';
import { apparentTempC, estimatePrecipProb, FmiWeatherProvider, parseFmiForecast } from './fmi';

const HELSINKI: LatLon = { lat: 60.17, lon: 24.94 };
const FIXED_NOW = 1_784_455_200_000; // matches the fixture's first hour

/** A stub fallback that returns sentinels so we can prove delegation happened. */
function sentinelFallback(): WeatherProvider {
  return {
    windAlong: async () =>
      [
        [{ windMs: -1, windFromDeg: 0, gustMs: 0, precipProb: 0, tempC: 0, time: 'FALLBACK' }],
      ] as WindGrid,
    daylight: async (): Promise<Daylight> => ({ sunrise: 'FB-RISE', sunset: 'FB-SET' }),
    recentPrecipMm: async () => 42,
  };
}

/** A scripted fetch returning the given text body (or throwing / non-OK). */
function textFetch(body: string, opts: { ok?: boolean; status?: number; throws?: boolean } = {}) {
  return (() => {
    if (opts.throws) return Promise.reject(new Error('offline'));
    return Promise.resolve({
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      text: () => Promise.resolve(body),
    } as Response);
  }) as unknown as typeof fetch;
}

describe('estimatePrecipProb', () => {
  it('maps modelled mm/h to a bounded 0–100 rain proxy (no POP in HARMONIE)', () => {
    expect(estimatePrecipProb(0)).toBe(0);
    expect(estimatePrecipProb(0.5)).toBe(50);
    expect(estimatePrecipProb(1)).toBe(100);
    expect(estimatePrecipProb(4)).toBe(100); // capped
    expect(estimatePrecipProb(NaN)).toBe(0);
  });
});

describe('apparentTempC', () => {
  it('derives a feels-like from temp/humidity/wind, undefined when any input is missing', () => {
    expect(apparentTempC(18.4, 74.9, 4.87)).toBeCloseTo(16.2, 1); // mild wind chill
    expect(apparentTempC(NaN, 74.9, 4.87)).toBeUndefined();
  });
});

describe('parseFmiForecast', () => {
  it('parses the captured HARMONIE fixture (local hour, derived feels-like)', () => {
    const samples = parseFmiForecast(fixtureXml);
    expect(samples).toHaveLength(9);
    expect(samples[0]).toMatchObject({
      windMs: 4.87,
      windFromDeg: 300,
      gustMs: 9.5,
      precipProb: 0,
      tempC: 18.4,
      time: '2026-07-19T13:00', // Helsinki local (UTC 10:00 + EEST), not raw UTC
    });
    expect(samples[0].feelsC).toBeCloseTo(16.2, 1);
    // Times are ascending, one hour apart.
    expect(samples[1].time).toBe('2026-07-19T14:00');
  });

  it('returns [] for empty/garbage bodies (so the provider can fall back)', () => {
    expect(parseFmiForecast('')).toEqual([]);
    expect(parseFmiForecast('<wfs:FeatureCollection numberMatched="0"/>')).toEqual([]);
  });

  it('STOPS at the first no-data hour (never compacts a gap → no hour misalignment)', () => {
    const mini = [
      '<swe:field name="temperature"/><swe:field name="windspeedms"/><swe:field name="winddirection"/>',
      '<gmlcov:positions>60 24 1000 60 24 2000 60 24 3000</gmlcov:positions>',
      '<gml:doubleOrNilReasonTupleList>15 5 180 15 NaN 200 16 6 190</gml:doubleOrNilReasonTupleList>',
    ].join('');
    const samples = parseFmiForecast(mini);
    expect(samples).toHaveLength(1); // the later valid row is NOT pulled forward past the gap
    expect(samples[0].windMs).toBe(5);
  });
});

describe('FmiWeatherProvider', () => {
  const base = (fetchFn: typeof fetch) => ({
    fetchFn,
    now: () => FIXED_NOW,
    fallback: sentinelFallback(),
  });

  it('windAlong parses FMI when the whole window is covered', async () => {
    const fmi = new FmiWeatherProvider(base(textFetch(fixtureXml)));
    const grid = await fmi.windAlong([HELSINKI], 9);
    expect(grid).toHaveLength(1);
    expect(grid[0]).toHaveLength(9);
    expect(grid[0][0].windMs).toBe(4.87);
    expect(grid[0][0].time).not.toBe('FALLBACK'); // came from FMI, not the fallback
  });

  it('falls back when FMI has no data (point outside the domain)', async () => {
    const fmi = new FmiWeatherProvider(
      base(textFetch('<wfs:FeatureCollection numberMatched="0"/>')),
    );
    expect((await fmi.windAlong([{ lat: 0, lon: 0 }], 6))[0][0].time).toBe('FALLBACK');
  });

  it('falls back when FMI covers only part of the window (short column)', async () => {
    const fmi = new FmiWeatherProvider(base(textFetch(fixtureXml)));
    const grid = await fmi.windAlong([HELSINKI], 12); // fixture only has 9 hours
    expect(grid[0][0].time).toBe('FALLBACK');
  });

  it('falls back when the FMI request fails (network / non-OK)', async () => {
    const down = new FmiWeatherProvider(base(textFetch('', { throws: true })));
    expect((await down.windAlong([HELSINKI], 6))[0][0].time).toBe('FALLBACK');
    const err = new FmiWeatherProvider(base(textFetch('', { ok: false, status: 500 })));
    expect((await err.windAlong([HELSINKI], 6))[0][0].time).toBe('FALLBACK');
  });

  it('caches an identical window (second call does not re-fetch)', async () => {
    let calls = 0;
    const counting = (() => {
      calls++;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(fixtureXml),
      } as Response);
    }) as unknown as typeof fetch;
    const fmi = new FmiWeatherProvider({
      fetchFn: counting,
      now: () => FIXED_NOW,
      fallback: sentinelFallback(),
    });
    await fmi.windAlong([HELSINKI], 9);
    await fmi.windAlong([HELSINKI], 9);
    expect(calls).toBe(1);
  });

  it('delegates daylight and recentPrecipMm to the fallback', async () => {
    const fmi = new FmiWeatherProvider(base(textFetch(fixtureXml)));
    expect(await fmi.daylight(HELSINKI)).toEqual({ sunrise: 'FB-RISE', sunset: 'FB-SET' });
    expect(await fmi.recentPrecipMm(HELSINKI, 24)).toBe(42);
  });
});
