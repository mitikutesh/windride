#!/usr/bin/env node
/**
 * Manual live smoke check for the openrouteservice adapter (WR-005). NEVER runs in CI.
 *
 *   VITE_LIVE_APIS=true VITE_ORS_API_KEY=xxxx npm run probe:ors [-- --force]
 *
 * Captures two real round-trip responses (small + medium loop) so the parser is verified against
 * the true shape, then frozen (fixtures/README.md). Respect the free-tier budget (API_NOTES §2:
 * <=~30 calls per dev session) — this makes exactly 2 calls.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

if (process.env.VITE_LIVE_APIS !== 'true') {
  console.error('Refusing to hit the live API: set VITE_LIVE_APIS=true to run the probe.');
  process.exit(1);
}
const key = process.env.VITE_ORS_API_KEY;
if (!key) {
  console.error('VITE_ORS_API_KEY is required for the ORS probe (openrouteservice.org -> token).');
  process.exit(1);
}
const force = process.argv.includes('--force');

const start = { lat: 60.17, lon: 24.65 }; // Espoo
const loops = [
  { name: 'small', lengthM: 20000, out: 'fixtures/ors/real-small.json' },
  { name: 'medium', lengthM: 50000, out: 'fixtures/ors/real-medium.json' },
];

mkdirSync('fixtures/ors', { recursive: true });
for (const loop of loops) {
  if (existsSync(loop.out) && !force) {
    console.error(`${loop.out} exists and fixtures are frozen. Re-capture with --force.`);
    process.exit(1);
  }
  const res = await fetch(
    `https://api.openrouteservice.org/v2/directions/cycling-regular/geojson`,
    {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: [[start.lon, start.lat]],
        elevation: true,
        extra_info: ['surface', 'waytype', 'steepness'],
        instructions: true,
        options: { round_trip: { length: loop.lengthM, points: 4, seed: 1 } },
      }),
    },
  );
  if (!res.ok) {
    console.error(`Probe (${loop.name}) failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const body = await res.json();
  writeFileSync(loop.out, JSON.stringify(body, null, 2) + '\n');
  const f = body.features[0];
  console.log(
    `Captured ${loop.name}: ${f.geometry.coordinates.length} pts, ${f.properties.summary.distance} m -> ${loop.out}`,
  );
}
