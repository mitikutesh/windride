#!/usr/bin/env node
/**
 * Manual live smoke check for the Digitransit transit adapter (WR-026). NEVER runs in CI.
 *
 *   VITE_LIVE_APIS=true VITE_DIGITRANSIT_KEY=xxxx npm run probe:digitransit [-- --force]
 *
 * Captures one real stopsByRadius response for Riihimäki station so the parser is verified against
 * the true shape, then frozen (fixtures/README.md). Makes exactly ONE call — respect the free tier.
 * Free key: https://portal-api.digitransit.fi/ .
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

if (process.env.VITE_LIVE_APIS !== 'true') {
  console.error('Refusing to hit the live API: set VITE_LIVE_APIS=true to run the probe.');
  process.exit(1);
}
const key = process.env.VITE_DIGITRANSIT_KEY;
if (!key) {
  console.error('VITE_DIGITRANSIT_KEY is required (portal-api.digitransit.fi).');
  process.exit(1);
}
const force = process.argv.includes('--force');
const out = 'fixtures/digitransit/real-riihimaki.json';

if (existsSync(out) && !force) {
  console.error(`${out} exists and fixtures are frozen. Re-capture with --force.`);
  process.exit(1);
}

const station = { lat: 60.7375, lon: 24.7736 }; // Riihimäki
const afterS = Math.floor(Date.now() / 1000);
const query = `{ stopsByRadius(lat: ${station.lat}, lon: ${station.lon}, radius: 800, first: 4) { edges { node { stop { name stoptimesWithoutPatterns(startTime: ${afterS}, numberOfDepartures: 8, omitCanceled: true) { serviceDay scheduledDeparture realtimeDeparture } } } } } }`;

const res = await fetch('https://api.digitransit.fi/routing/v2/hsl/gtfs/v1', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'digitransit-subscription-key': key },
  body: JSON.stringify({ query }),
});
if (!res.ok) {
  console.error(`Probe failed: HTTP ${res.status}`);
  process.exit(1);
}
const body = await res.json();
mkdirSync('fixtures/digitransit', { recursive: true });
writeFileSync(out, JSON.stringify(body, null, 2) + '\n');
const edges = body?.data?.stopsByRadius?.edges ?? [];
console.log(`Captured ${edges.length} nearby stops -> ${out}`);
