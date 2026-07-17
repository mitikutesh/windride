// adapters/weather/index.ts — WeatherProvider contract (WR-003, ARCHITECTURE §4).
// Adapters are the ONLY place fetch() may appear (CLAUDE.md rule 4).
import type { Daylight, LatLon, WindGrid } from '../../domain';

export interface WeatherProvider {
  /** One call: hourly samples for each point for the next `hours` hours. Result is [pointIdx][hourIdx]. */
  windAlong(points: LatLon[], hours: number): Promise<WindGrid>;
  daylight(p: LatLon): Promise<Daylight>;
}

export type { Daylight, LatLon, WindGrid, WindSample } from '../../domain';
