// adapters/weather/mock.ts — deterministic, zero-network WeatherProvider (WR-003).
// Feeds the whole app offline and backs the provider contract tests.
import openMeteoSampleRaw from '../../../fixtures/openmeteo/real-espoo.json?raw';
import type { Daylight, LatLon, WindGrid, WindSample } from '../../domain';
import { ProviderError, type ProviderErrorKind } from '../errors';
import type { WeatherProvider } from './index';

export type WeatherScenario = 'sw-steady' | 'shifting' | 'fixture';

export interface MockWeatherOptions {
  /** Which synthetic/fixture wind story to produce. Default: the acceptance "SW 8 m/s steady". */
  scenario?: WeatherScenario;
  /** When set, every method rejects with this ProviderError kind (for error-path tests). */
  failWith?: ProviderErrorKind;
}

// Fixed base hour so output is fully deterministic (no wall clock). SW 8 m/s over Espoo, summer.
const BASE_ISO = '2026-07-10T17:00:00Z';
const HOUR_MS = 3_600_000;

function isoHour(h: number): string {
  // "2026-07-10T17:00" style (drop seconds/zone for the local-hour convention in WindSample.time).
  return new Date(Date.parse(BASE_ISO) + h * HOUR_MS).toISOString().slice(0, 16);
}

// The captured Open-Meteo shape: a top-level array, one object per point (WR-004).
type OpenMeteoPoint = {
  hourly: {
    time: string[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
    wind_gusts_10m: number[];
    temperature_2m: number[];
    precipitation_probability: Array<number | null>;
  };
  daily: { sunrise: string[]; sunset: string[] };
};
const FIXTURE = JSON.parse(openMeteoSampleRaw) as OpenMeteoPoint[];

function sampleFor(scenario: WeatherScenario, pointIdx: number, hour: number): WindSample {
  const time = isoHour(hour);
  if (scenario === 'sw-steady') {
    // Wind FROM the south-west (225°), steady 8 m/s — the WR-011 acceptance fixture.
    return { windMs: 8, windFromDeg: 225, gustMs: 12, precipProb: 10, tempC: 17, time };
  }
  if (scenario === 'shifting') {
    // Direction veers with the forecast; speed and temperature drift. Deterministic per hour.
    const windFromDeg = (200 + hour * 15) % 360;
    const windMs = 6 + (hour % 3);
    return {
      windMs,
      windFromDeg,
      gustMs: Math.round(windMs * 1.4 * 10) / 10,
      precipProb: Math.min(100, 10 + hour * 4),
      tempC: 17 - hour * 0.3,
      time,
    };
  }
  // 'fixture' — cycle the captured real sample, varying by point so points differ. Time stays
  // synthetic (isoHour) so it is always monotonic even if `hours` exceeds the captured length.
  const r = FIXTURE[pointIdx % FIXTURE.length];
  const i = hour % r.hourly.time.length;
  return {
    windMs: r.hourly.wind_speed_10m[i],
    windFromDeg: r.hourly.wind_direction_10m[i],
    gustMs: r.hourly.wind_gusts_10m[i],
    precipProb: r.hourly.precipitation_probability[i] ?? 0,
    tempC: r.hourly.temperature_2m[i],
    time,
  };
}

export class MockWeatherProvider implements WeatherProvider {
  private readonly scenario: WeatherScenario;
  private readonly failWith?: ProviderErrorKind;

  constructor(opts: MockWeatherOptions = {}) {
    this.scenario = opts.scenario ?? 'sw-steady';
    this.failWith = opts.failWith;
  }

  async windAlong(points: LatLon[], hours: number): Promise<WindGrid> {
    if (this.failWith) throw new ProviderError(this.failWith);
    // [pointIdx][hourIdx] — outer over points, inner over hours (never transpose).
    return points.map((_p, pointIdx) =>
      Array.from({ length: hours }, (_h, hour) => sampleFor(this.scenario, pointIdx, hour)),
    );
  }

  async daylight(_p: LatLon): Promise<Daylight> {
    if (this.failWith) throw new ProviderError(this.failWith);
    const r = FIXTURE[0];
    return { sunrise: r.daily.sunrise[0], sunset: r.daily.sunset[0] };
  }
}
