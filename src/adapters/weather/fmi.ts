/**
 * adapters/weather/fmi.ts — Finnish Meteorological Institute (ilmatieteenlaitos.fi) weather.
 *
 * FMI's HARMONIE model is the highest-accuracy local forecast for Finland/the Nordics, and its Open
 * Data WFS is free, keyless, and CORS-open (Access-Control-Allow-Origin: *) — so a client-only PWA
 * can call it directly (adapters are the only place fetch may appear, CLAUDE.md rule 4).
 *
 * This provider is a DECORATOR over Open-Meteo: it upgrades `windAlong` to FMI's HARMONIE model
 * (real wind + gust, which the crosswind-safety score needs) and delegates daylight + recent
 * precipitation to the fallback. On any FMI failure, or a point/window FMI can't fully cover, the
 * WHOLE call falls back to Open-Meteo — so the grid is always single-source and hour-aligned, and it
 * degrades gracefully worldwide with no registry coordinate logic.
 *
 * HARMONIE is deterministic and has no probability-of-precipitation, so `precipProb` is ESTIMATED
 * from the modelled `precipitation1h` (mm) — a rain-intensity proxy, not a true POP (see
 * `estimatePrecipProb`). Apparent temperature isn't a HARMONIE field either, so `feelsC` is derived
 * from temperature + humidity + wind (Australian apparent-temperature formula).
 */
import type { Daylight, LatLon, WindGrid, WindSample } from '../../domain';
import { ProviderError } from '../errors';
import { createWeatherCache, type WeatherCache } from './cache';
import type { WeatherProvider } from './index';
import { OpenMeteoProvider } from './openMeteo';

const ENDPOINT = 'https://opendata.fmi.fi/wfs';
const STORED_QUERY = 'fmi::forecast::harmonie::surface::point::multipointcoverage';
const PARAMS = 'temperature,humidity,windspeedms,winddirection,windgust,precipitation1h';
const TTL_MS = 30 * 60 * 1000;
// FMI's forecast backend has whole-service outages (every forecast model 400s with an internal
// "stod" error while observations stay up). The per-window cache is keyed by route points, which
// change every plan, so without this a down FMI is re-hit — and re-logged as a console 400 — on
// every plan. After a failure we skip FMI entirely for this long and serve the fallback directly;
// it self-heals when the cooldown lapses (and FMI has recovered).
const OUTAGE_COOLDOWN_MS = 10 * 60 * 1000;
// FMI serves Finland/the Nordics; its unix times are UTC, so we render the local hour in Helsinki
// time to honour WindSample.time's "local hour" contract (domain.ts) — matching Open-Meteo/mock.
const TZ = 'Europe/Helsinki';

/** HARMONIE has no POP; estimate a 0–100 "rain-ish" weight from modelled mm/h (documented proxy). */
export function estimatePrecipProb(precipMm: number): number {
  if (!Number.isFinite(precipMm) || precipMm <= 0) return 0;
  return Math.min(100, Math.round(precipMm * 100)); // ~1 mm/h ⇒ 100; light drizzle ⇒ small
}

/** Australian apparent temperature (°C) from temp/humidity/wind — HARMONIE has no feels-like field. */
export function apparentTempC(
  tempC: number,
  humidityPct: number,
  windMs: number,
): number | undefined {
  if (!Number.isFinite(tempC) || !Number.isFinite(humidityPct) || !Number.isFinite(windMs)) {
    return undefined;
  }
  const vapourPressure = (humidityPct / 100) * 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC));
  return Math.round((tempC + 0.33 * vapourPressure - 0.7 * windMs - 4.0) * 10) / 10;
}

/** Local wall-clock hour ("YYYY-MM-DDTHH:MM", Helsinki time) from a UTC unix-seconds timestamp. */
function localHour(timeS: number): string {
  return new Date(timeS * 1000)
    .toLocaleString('sv-SE', { timeZone: TZ })
    .replace(' ', 'T')
    .slice(0, 16);
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
 * Pure. Returns the LEADING CONTIGUOUS run of fully-valid hours: on the first row with missing data
 * (NaN = FMI "no data here") it STOPS rather than compacting, so a gap can never silently shift an
 * hour index or under-fill the window — the provider then falls back if the run is too short. Row i
 * of the tuple list aligns with position i (lat lon unixtime).
 */
export function parseFmiForecast(xml: string): WindSample[] {
  const fields = [...xml.matchAll(/swe:field name="([^"]+)"/g)].map((m) => m[1]);
  const posBlock = extractBlock(xml, 'gmlcov:positions');
  const tupBlock = extractBlock(xml, 'gml:doubleOrNilReasonTupleList');
  if (!fields.length || !posBlock || !tupBlock) return [];

  const pos = numbers(posBlock); // flat [lat, lon, time, ...]
  const tup = numbers(tupBlock); // flat rows of `fields.length`
  const rows = Math.floor(pos.length / 3);
  const col = (row: number[], name: string) => row[fields.indexOf(name)] ?? NaN;

  const out: WindSample[] = [];
  for (let i = 0; i < rows; i++) {
    const timeS = pos[i * 3 + 2];
    const row = tup.slice(i * fields.length, (i + 1) * fields.length);
    const windMs = col(row, 'windspeedms');
    const windFromDeg = col(row, 'winddirection');
    const tempC = col(row, 'temperature');
    // Stop at the first incomplete hour — never compact (that would misalign later hours).
    if (![windMs, windFromDeg, tempC, timeS].every(Number.isFinite)) break;
    const gust = col(row, 'windgust');
    const sample: WindSample = {
      windMs,
      windFromDeg: ((windFromDeg % 360) + 360) % 360,
      gustMs: Number.isFinite(gust) ? gust : windMs, // steady wind if gust missing (never higher)
      precipProb: estimatePrecipProb(col(row, 'precipitation1h')),
      tempC,
      time: localHour(timeS),
    };
    const feels = apparentTempC(tempC, col(row, 'humidity'), windMs);
    if (feels !== undefined) sample.feelsC = feels;
    out.push(sample);
  }
  return out;
}

function fmiCacheKey(points: LatLon[], hours: number, nowMs: number): string {
  const pts = points.map((p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`).join('|');
  return `fmi#${pts}#h${hours}#${new Date(nowMs).toISOString().slice(0, 13)}`; // date-hour bucket
}

export interface FmiOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  endpoint?: string;
  cache?: WeatherCache;
  /** Where non-wind calls and out-of-domain / failed wind calls go. Defaults to Open-Meteo. */
  fallback?: WeatherProvider;
}

export class FmiWeatherProvider implements WeatherProvider {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly endpoint: string;
  private readonly cache: WeatherCache;
  private readonly fallback: WeatherProvider;
  /** Unix ms until which FMI is treated as down (circuit breaker); 0 = closed. */
  private outageUntil = 0;

  constructor(opts: FmiOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.now = opts.now ?? (() => Date.now());
    this.endpoint = opts.endpoint ?? ENDPOINT;
    this.cache = opts.cache ?? createWeatherCache(this.now);
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
      endtime: iso(startMs + hours * 3_600_000), // hours+1 inclusive rows — a one-hour buffer
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

  private async fetchGrid(points: LatLon[], hours: number): Promise<WindGrid> {
    try {
      const grid = await Promise.all(points.map((p) => this.fetchPoint(p, hours)));
      // Every point needs `hours` contiguous valid samples; if any is short (gap / outside domain /
      // partial coverage) fall back for the WHOLE call, keeping the grid single-source + hour-aligned.
      // A short column is out-of-domain (e.g. a point outside Finland), NOT an outage — fall back
      // for this call but leave the breaker closed so in-domain points still reach FMI.
      if (grid.some((col) => col.length < hours)) return this.fallback.windAlong(points, hours);
      return grid.map((col) => col.slice(0, hours));
    } catch {
      // A genuine FMI failure (network / non-OK / rate limit) opens the breaker.
      this.outageUntil = this.now() + OUTAGE_COOLDOWN_MS;
      return this.fallback.windAlong(points, hours);
    }
  }

  async windAlong(points: LatLon[], hours: number): Promise<WindGrid> {
    const key = fmiCacheKey(points, hours, this.now());
    const cached = await this.cache.get(key);
    if (cached) return cached;
    // Breaker open (FMI recently failed) → straight to the fallback; no FMI request, no repeat 400.
    if (this.now() < this.outageUntil) return this.fallback.windAlong(points, hours);
    const grid = await this.fetchGrid(points, hours);
    await this.cache.set(key, grid, this.now() + TTL_MS);
    return grid;
  }

  daylight(p: LatLon): Promise<Daylight> {
    return this.fallback.daylight(p); // FMI's forecast query carries no sunrise/sunset
  }

  recentPrecipMm(p: LatLon, hours: number): Promise<number> {
    return this.fallback.recentPrecipMm?.(p, hours) ?? Promise.resolve(0);
  }
}
