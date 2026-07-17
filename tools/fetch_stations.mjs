#!/usr/bin/env node
/**
 * tools/fetch_stations.mjs — regenerate src/data/stations.uusimaa.json (WR-026).
 *
 * MANUAL, offline preprocessing — never run in CI (CLAUDE.md rule 3). It queries the Digitransit
 * routing GraphQL API for rail + trunk-bus stations in the Helsinki/Uusimaa region and writes the
 * checked-in station list the downwind planner consumes. Run it occasionally to refresh; the app
 * itself never depends on it at runtime (the JSON is bundled).
 *
 * Usage:
 *   DIGITRANSIT_SUBSCRIPTION_KEY=xxxx node tools/fetch_stations.mjs
 *
 * Get a free key at https://portal-api.digitransit.fi/ . Endpoint + schema: API_NOTES §3.
 * We keep only stations whose vehicleMode is RAIL, plus a hand-curated set of trunk-bus hubs the
 * GraphQL `stations` set omits (those stay in the JSON if already present — this script MERGES,
 * it does not blow away manual bus entries).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'data',
  'stations.uusimaa.json',
);
const ENDPOINT = 'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1';
// Roughly the Uusimaa + Häme rail corridor reachable for a 30–80 km downwind ride from Helsinki.
const BBOX = { minLat: 59.9, maxLat: 61.1, minLon: 23.4, maxLon: 25.9 };

const key = process.env.DIGITRANSIT_SUBSCRIPTION_KEY;
if (!key) {
  console.error('Set DIGITRANSIT_SUBSCRIPTION_KEY (free key from portal-api.digitransit.fi).');
  process.exit(1);
}

const QUERY = `{
  stations(name: "") {
    gtfsId
    name
    lat
    lon
    vehicleMode
  }
}`;

const slug = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');

async function main() {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'digitransit-subscription-key': key },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!res.ok) throw new Error(`Digitransit ${res.status} ${res.statusText}`);
  const body = await res.json();
  const stations = body?.data?.stations ?? [];

  const rail = stations
    .filter((s) => s.vehicleMode === 'RAIL' && s.lat && s.lon)
    .filter(
      (s) =>
        s.lat >= BBOX.minLat &&
        s.lat <= BBOX.maxLat &&
        s.lon >= BBOX.minLon &&
        s.lon <= BBOX.maxLon,
    )
    .map((s) => ({
      id: slug(s.name),
      name: s.name,
      lat: Math.round(s.lat * 1e4) / 1e4,
      lon: Math.round(s.lon * 1e4) / 1e4,
      modes: ['rail'],
    }));

  // Merge: keep existing hand-curated bus-only entries that the rail query won't return.
  const existing = JSON.parse(readFileSync(OUT, 'utf8'));
  const byId = new Map(existing.map((s) => [s.id, s]));
  for (const s of rail) byId.set(s.id, { ...byId.get(s.id), ...s });

  const merged = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(OUT, JSON.stringify(merged, null, 2) + '\n');
  console.log(`Wrote ${merged.length} stations to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
