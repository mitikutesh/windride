/**
 * data/stations.ts — the checked-in transit-station list for downwind endpoints (WR-026).
 *
 * The list is a static asset bundled at build time (no runtime fetch, no live dependency for the
 * list itself — the acceptance requires this). Regenerate it with `node tools/fetch_stations.mjs`
 * (documented there); only the return-service lookup at plan time is live (Digitransit adapter).
 */
import type { Station } from '../engine/downwind';
import raw from './stations.uusimaa.json';

export const STATIONS: Station[] = raw as Station[];

/** All known stations (rail + trunk bus) for the region. */
export function loadStations(): Station[] {
  return STATIONS;
}
