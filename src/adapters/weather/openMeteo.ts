// adapters/weather/openMeteo.ts — real Open-Meteo WeatherProvider (WR-004).
// One multipoint call -> WindGrid[pointIdx][hourIdx], starting at the CURRENT hour. Keyless,
// CC-BY 4.0 (attribution in the UI footer, WR-002). wind_direction is meteorological (FROM) —
// see CLAUDE.md domain warnings.
import type { Daylight, LatLon, WindGrid, WindSample } from '../../domain';
import { ProviderError } from '../errors';
import { createWeatherCache, type WeatherCache } from './cache';
import type { WeatherProvider } from './index';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const HOURLY =
  'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,apparent_temperature,precipitation_probability';
const TTL_MS = 30 * 60 * 1000;

// Real multipoint responses are a top-level ARRAY (one object per requested point, in order);
// a single-point response (e.g. daily-only) is a bare object. Both are normalised here.
type OpenMeteoHourly = {
  time: string[];
  wind_speed_10m: number[];
  wind_direction_10m: number[];
  wind_gusts_10m: number[];
  temperature_2m: number[];
  apparent_temperature?: number[];
  precipitation_probability: Array<number | null>;
};
type OpenMeteoPoint = { hourly?: OpenMeteoHourly; daily?: { sunrise: string[]; sunset: string[] } };

function asPointArray(body: unknown): OpenMeteoPoint[] {
  const arr = (Array.isArray(body) ? body : [body]) as OpenMeteoPoint[];
  if (arr.length === 0 || arr[0] == null) throw new ProviderError('badResponse', 'empty response');
  return arr;
}

const HOURLY_FIELDS: Array<keyof OpenMeteoHourly> = [
  'time',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'temperature_2m',
  'precipitation_probability',
];

export function parseWindGrid(body: unknown, pointCount: number, hours: number): WindGrid {
  const arr = asPointArray(body);
  const grid: WindGrid = [];
  for (let p = 0; p < pointCount; p++) {
    const h = arr[p]?.hourly;
    // Guard the param-rename risk (API_NOTES §1): every required array must exist and be long enough.
    if (!h || HOURLY_FIELDS.some((f) => !Array.isArray(h[f]) || h[f].length < hours)) {
      throw new ProviderError('badResponse', `point ${p} missing ${hours}h of hourly data`);
    }
    const perPoint: WindSample[] = [];
    for (let i = 0; i < hours; i++) {
      perPoint.push({
        windMs: h.wind_speed_10m[i],
        windFromDeg: h.wind_direction_10m[i],
        gustMs: h.wind_gusts_10m[i],
        precipProb: h.precipitation_probability[i] ?? 0,
        tempC: h.temperature_2m[i],
        feelsC: h.apparent_temperature?.[i],
        time: h.time[i],
      });
    }
    grid.push(perPoint);
  }
  return grid;
}

export function parseDaylight(body: unknown): Daylight {
  const d = asPointArray(body)[0].daily;
  if (!d?.sunrise?.[0] || !d?.sunset?.[0]) throw new ProviderError('badResponse', 'no daylight');
  return { sunrise: d.sunrise[0], sunset: d.sunset[0] };
}

function round3(n: number): string {
  return n.toFixed(3);
}

/** Cache key: rounded points + hours + the current date-hour bucket (WR-004 technical notes). */
function cacheKey(points: LatLon[], hours: number, nowMs: number): string {
  const pts = points.map((p) => `${round3(p.lat)},${round3(p.lon)}`).join('|');
  const dateHour = new Date(nowMs).toISOString().slice(0, 13); // YYYY-MM-DDTHH
  return `${pts}#h${hours}#${dateHour}`;
}

export interface OpenMeteoOptions {
  /** Injectable fetch for fixture-mode tests (defaults to global fetch). */
  fetchFn?: typeof fetch;
  cache?: WeatherCache;
  /** Injectable clock (ms) for deterministic cache keys/TTL in tests. */
  now?: () => number;
}

export class OpenMeteoProvider implements WeatherProvider {
  private readonly fetchFn: typeof fetch;
  private readonly cache: WeatherCache;
  private readonly now: () => number;

  constructor(opts: OpenMeteoOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.now = opts.now ?? (() => Date.now());
    this.cache = opts.cache ?? createWeatherCache(this.now);
  }

  private buildUrl(points: LatLon[], hours: number): string {
    const params = new URLSearchParams({
      latitude: points.map((p) => p.lat).join(','),
      longitude: points.map((p) => p.lon).join(','),
      hourly: HOURLY,
      daily: 'sunrise,sunset',
      wind_speed_unit: 'ms',
      timezone: 'auto',
      // Slot 0 is the CURRENT hour, so windAlong returns the NEXT `hours` hours (not from midnight).
      forecast_hours: String(hours),
    });
    return `${ENDPOINT}?${params.toString()}`;
  }

  private async fetchJson(url: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(url);
    } catch {
      throw new ProviderError('network', 'fetch failed');
    }
    if (res.status === 429) throw new ProviderError('quota', 'Open-Meteo daily limit');
    if (!res.ok) throw new ProviderError('badResponse', `HTTP ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new ProviderError('badResponse', 'invalid JSON');
    }
  }

  async windAlong(points: LatLon[], hours: number): Promise<WindGrid> {
    const key = cacheKey(points, hours, this.now());
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const body = await this.fetchJson(this.buildUrl(points, hours));
    const grid = parseWindGrid(body, points.length, hours);
    await this.cache.set(key, grid, this.now() + TTL_MS);
    return grid;
  }

  async daylight(p: LatLon): Promise<Daylight> {
    const params = new URLSearchParams({
      latitude: String(p.lat),
      longitude: String(p.lon),
      daily: 'sunrise,sunset',
      timezone: 'auto',
    });
    const body = await this.fetchJson(`${ENDPOINT}?${params.toString()}`);
    return parseDaylight(body);
  }

  /** Prior-`hours` precipitation (mm) for the ice-risk heuristic — Open-Meteo `past_hours` param. */
  async recentPrecipMm(p: LatLon, hours: number): Promise<number> {
    const params = new URLSearchParams({
      latitude: String(p.lat),
      longitude: String(p.lon),
      hourly: 'precipitation',
      past_hours: String(hours),
      forecast_hours: '1',
      timezone: 'auto',
    });
    const body = await this.fetchJson(`${ENDPOINT}?${params.toString()}`);
    return parseRecentPrecipMm(body);
  }
}

/** Sum the hourly precipitation array (mm) from a past_hours response; 0 when absent. */
export function parseRecentPrecipMm(body: unknown): number {
  const arr = Array.isArray(body) ? body : [body];
  const precip = (arr[0] as { hourly?: { precipitation?: Array<number | null> } })?.hourly
    ?.precipitation;
  if (!Array.isArray(precip)) return 0;
  return precip.reduce<number>((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
}
