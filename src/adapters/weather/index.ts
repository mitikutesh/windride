// adapters/weather/index.ts — WeatherProvider contract (WR-003, ARCHITECTURE §4).
// Adapters are the ONLY place fetch() may appear (CLAUDE.md rule 4).
import type { Daylight, LatLon, WindGrid } from '../../domain';

export interface WeatherProvider {
  /** One call: hourly samples for each point for the next `hours` hours. Result is [pointIdx][hourIdx]. */
  windAlong(points: LatLon[], hours: number): Promise<WindGrid>;
  daylight(p: LatLon): Promise<Daylight>;
  /**
   * Total precipitation (mm) over the prior `hours` hours — the WR-027 ice-risk heuristic needs to
   * know whether it recently rained/snowed. Open-Meteo supplies it via `past_hours` + hourly=
   * precipitation. Optional so older providers/mocks may omit it (the planner treats absence as 0).
   */
  recentPrecipMm?(p: LatLon, hours: number): Promise<number>;
}

export type { Daylight, LatLon, WindGrid, WindSample } from '../../domain';
