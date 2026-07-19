import { describe, expect, it } from 'vitest';
import fixtureXml from '../../../fixtures/fmi/forecast-helsinki.xml?raw';
import type { Daylight, LatLon, WindGrid } from '../../domain';
import type { WeatherProvider } from './index';
import { estimatePrecipProb, FmiWeatherProvider, parseFmiForecast } from './fmi';

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

describe('parseFmiForecast', () => {
  it('parses the captured HARMONIE fixture with hand-checked first-row values', () => {
    const samples = parseFmiForecast(fixtureXml);
    expect(samples).toHaveLength(9);
    expect(samples[0]).toEqual({
      windMs: 4.87,
      windFromDeg: 300,
      gustMs: 9.5,
      precipProb: 0,
      tempC: 18.4,
      time: '2026-07-19T10:00',
    });
  });

  it('returns [] for empty/garbage bodies (so the provider can fall back)', () => {
    expect(parseFmiForecast('')).toEqual([]);
    expect(parseFmiForecast('<wfs:FeatureCollection numberMatched="0"/>')).toEqual([]);
  });

  it('skips rows with no wind (NaN = FMI "no data here")', () => {
    const mini = [
      '<swe:field name="windspeedms"/><swe:field name="winddirection"/>',
      '<gmlcov:positions>60 24 1000 60 24 2000</gmlcov:positions>',
      '<gml:doubleOrNilReasonTupleList>5 180 NaN 200</gml:doubleOrNilReasonTupleList>',
    ].join('');
    const samples = parseFmiForecast(mini);
    expect(samples).toHaveLength(1); // the NaN-wind row is dropped
    expect(samples[0].windMs).toBe(5);
    expect(samples[0].windFromDeg).toBe(180);
  });
});

describe('FmiWeatherProvider', () => {
  const base = (fetchFn: typeof fetch) => ({
    fetchFn,
    now: () => FIXED_NOW,
    fallback: sentinelFallback(),
  });

  it('windAlong parses FMI when data is present', async () => {
    const fmi = new FmiWeatherProvider(base(textFetch(fixtureXml)));
    const grid = await fmi.windAlong([HELSINKI], 9);
    expect(grid).toHaveLength(1);
    expect(grid[0]).toHaveLength(9);
    expect(grid[0][0].windMs).toBe(4.87);
    expect(grid[0][0].time).not.toBe('FALLBACK'); // came from FMI, not the fallback
  });

  it('falls back to Open-Meteo when FMI has no data (point outside the domain)', async () => {
    const fmi = new FmiWeatherProvider(
      base(textFetch('<wfs:FeatureCollection numberMatched="0"/>')),
    );
    const grid = await fmi.windAlong([{ lat: 0, lon: 0 }], 6);
    expect(grid[0][0].time).toBe('FALLBACK');
  });

  it('falls back when the FMI request fails (network / non-OK)', async () => {
    const down = new FmiWeatherProvider(base(textFetch('', { throws: true })));
    expect((await down.windAlong([HELSINKI], 6))[0][0].time).toBe('FALLBACK');
    const err = new FmiWeatherProvider(base(textFetch('', { ok: false, status: 500 })));
    expect((await err.windAlong([HELSINKI], 6))[0][0].time).toBe('FALLBACK');
  });

  it('delegates daylight and recentPrecipMm to the fallback', async () => {
    const fmi = new FmiWeatherProvider(base(textFetch(fixtureXml)));
    expect(await fmi.daylight(HELSINKI)).toEqual({ sunrise: 'FB-RISE', sunset: 'FB-SET' });
    expect(await fmi.recentPrecipMm(HELSINKI, 24)).toBe(42);
  });
});
