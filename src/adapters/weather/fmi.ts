/**
 * adapters/weather/fmi.ts — Finnish Meteorological Institute (ilmatieteenlaitos.fi) weather.
 *
 * FMI's HARMONIE model is the highest-accuracy local forecast for Finland/the Nordics, and its Open
 * Data WFS is free, keyless, and CORS-open (Access-Control-Allow-Origin: *) — so a client-only PWA
 * can call it directly (adapters are the only place fetch may appear, CLAUDE.md rule 4).
 *
 * This provider is a DECORATOR over Open-Meteo: it upgrades `windAlong` to FMI where FMI has data
 * (real wind + gust, which the crosswind-safety score needs), and delegates everything else —
 * daylight, recent precipitation, and any point outside FMI's domain or any FMI failure — to the
 * Open-Meteo fallback. So it degrades gracefully worldwide with no registry coordinate logic.
 *
 * HARMONIE is deterministic and has no probability-of-precipitation, so `precipProb` is ESTIMATED
 * from the modelled `precipitation1h` (mm) — a rain-intensity proxy, not a true POP. Documented in
 * `estimatePrecipProb` and surfaced honestly (the RainAvoid score reads it as an avoid-the-wet weight).
 */
import type { Daylight, LatLon, WindGrid, WindSample } from '../../domain';
import { ProviderError } from '../errors';
import type { WeatherProvider } from './index';
import { OpenMeteoProvider } from './openMeteo';

const ENDPOINT = 'https://opendata.fmi.fi/wfs';
const STORED_QUERY = 'fmi::forecast::harmonie::surface::point::multipointcoverage';
const PARAMS = 'temperature,humidity,windspeedms,winddirection,windgust,precipitation1h';

/** HARMONIE has no POP; estimate a 0–100 "rain-ish" weight from modelled mm/h (documented proxy). */
export function estimatePrecipProb(precipMm: number): number {
  if (!Number.isFinite(precipMm) || precipMm <= 0) return 0;
  return Math.min(100, Math.round(precipMm * 100)); // ~1 mm/h ⇒ 100; light drizzle ⇒ small
}

function extractBlock(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? m[1] : null;
}
const numbers = (s: string): number[] =>
  s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => parseFloat(t)); // "NaN" → NaN

/**
 * Parse an FMI multipointcoverage response into an ordered WindSample[] (one row per forecast hour).
 * Pure. Returns [] when there's no usable data (empty coverage / all-NaN / point outside domain) so
 * the provider can fall back. Row i of the tuple list aligns with position i (lat lon unixtime).
 */
export function parseFmiForecast(xml: string): WindSample[] {
  const fields = [...xml.matchAll(/swe:field name="([^"]+)"/g)].map((m) => m[1]);
  const posBlock = extractBlock(xml, 'gmlcov:positions');
  const tupBlock = extractBlock(xml, 'gml:doubleOrNilReasonTupleList');
  if (!fields.length || !posBlock || !tupBlock) return [];

  const pos = numbers(posBlock); // flat [lat, lon, time, lat, lon, time, ...]
  const tup = numbers(tupBlock); // flat rows of `fields.length`
  const rows = Math.floor(pos.length / 3);
  const col = (row: number[], name: string) => row[fields.indexOf(name)] ?? NaN;

  const out: WindSample[] = [];
  for (let i = 0; i < rows; i++) {
    const timeS = pos[i * 3 + 2];
    const row = tup.slice(i * fields.length, (i + 1) * fields.length);
    const windMs = col(row, 'windspeedms');
    const windFromDeg = col(row, 'winddirection');
    // A row with no wind is FMI signalling "no data here" (outside domain / gap) — skip it.
    if (!Number.isFinite(windMs) || !Number.isFinite(windFromDeg) || !Number.isFinite(timeS)) {
      continue;
    }
    const gust = col(row, 'windgust');
    out.push({
      windMs,
      windFromDeg,
      gustMs: Number.isFinite(gust) ? gust : windMs, // fall back to steady wind if gust missing
      precipProb: estimatePrecipProb(col(row, 'precipitation1h')),
      tempC: col(row, 'temperature'),
      time: new Date(timeS * 1000).toISOString().slice(0, 16), // "YYYY-MM-DDTHH:MM"
    });
  }
  return out;
}

export interface FmiOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  endpoint?: string;
  /** Where non-wind calls and out-of-domain / failed wind calls go. Defaults to Open-Meteo. */
  fallback?: WeatherProvider;
}

export class FmiWeatherProvider implements WeatherProvider {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly endpoint: string;
  private readonly fallback: WeatherProvider;

  constructor(opts: FmiOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.now = opts.now ?? (() => Date.now());
    this.endpoint = opts.endpoint ?? ENDPOINT;
    this.fallback = opts.fallback ?? new OpenMeteoProvider();
  }

  private buildUrl(p: LatLon, hours: number): string {
    const startMs = Math.floor(this.now() / 3_600_000) * 3_600_000; // floor to the hour
    const iso = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`;
    const params = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'getFeature',
      storedquery_id: STORED_QUERY,
      latlon: `${p.lat},${p.lon}`,
      parameters: PARAMS,
      starttime: iso(startMs),
      endtime: iso(startMs + hours * 3_600_000),
      timestep: '60',
    });
    return `${this.endpoint}?${params.toString()}`;
  }

  private async fetchPoint(p: LatLon, hours: number): Promise<WindSample[]> {
    let res: Response;
    try {
      res = await this.fetchFn(this.buildUrl(p, hours));
    } catch {
      throw new ProviderError('network', 'FMI fetch failed');
    }
    if (res.status === 429) throw new ProviderError('quota', 'FMI rate limited');
    if (!res.ok) throw new ProviderError('badResponse', `FMI ${res.status}`);
    return parseFmiForecast(await res.text());
  }

  async windAlong(points: LatLon[], hours: number): Promise<WindGrid> {
    try {
      const grid = await Promise.all(points.map((p) => this.fetchPoint(p, hours)));
      // Any point with no FMI data (outside the domain) ⇒ fall back for the whole call so the grid
      // is consistent (one source), matching the app's spatially-uniform wind assumption.
      if (grid.some((col) => col.length === 0)) return this.fallback.windAlong(points, hours);
      return grid.map((col) => col.slice(0, hours));
    } catch {
      return this.fallback.windAlong(points, hours);
    }
  }

  daylight(p: LatLon): Promise<Daylight> {
    return this.fallback.daylight(p); // FMI's forecast query carries no sunrise/sunset
  }

  recentPrecipMm(p: LatLon, hours: number): Promise<number> {
    return this.fallback.recentPrecipMm?.(p, hours) ?? Promise.resolve(0);
  }
}
