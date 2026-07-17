#!/usr/bin/env node
/**
 * Manual live smoke check for the Open-Meteo weather adapter (WR-004). NEVER runs in CI.
 *
 *   VITE_LIVE_APIS=true npm run probe:weather
 *
 * Captures a real multipoint response into fixtures/openmeteo/real-espoo.json so the adapter
 * parser is verified against the true shape, then frozen (fixtures/README.md). Open-Meteo is
 * keyless and free for non-commercial use (API_NOTES §1); attribution is wired into the UI.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

if (process.env.VITE_LIVE_APIS !== 'true') {
  console.error('Refusing to hit the live API: set VITE_LIVE_APIS=true to run the probe.');
  process.exit(1);
}

// A few Espoo/Uusimaa points — enough to exercise the multipoint array shape.
const points = [
  { lat: 60.17, lon: 24.65 },
  { lat: 60.25, lon: 24.75 },
  { lat: 60.2, lon: 24.55 },
];
const HOURLY =
  'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,apparent_temperature,precipitation_probability';
const url =
  'https://api.open-meteo.com/v1/forecast' +
  `?latitude=${points.map((p) => p.lat).join(',')}` +
  `&longitude=${points.map((p) => p.lon).join(',')}` +
  `&hourly=${HOURLY}&daily=sunrise,sunset&wind_speed_unit=ms&timezone=auto&forecast_days=2`;

const res = await fetch(url);
if (!res.ok) {
  console.error(`Probe failed: HTTP ${res.status}`);
  process.exit(1);
}
const body = await res.json();
const out = 'fixtures/openmeteo/real-espoo.json';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(body, null, 2) + '\n');

const arr = Array.isArray(body) ? body : [body];
console.log(`Captured ${arr.length} points x ${arr[0].hourly.time.length} hours -> ${out}`);
console.log('Spot check point0 hour0:', {
  time: arr[0].hourly.time[0],
  windMs: arr[0].hourly.wind_speed_10m[0],
  windFromDeg: arr[0].hourly.wind_direction_10m[0],
  sunrise: arr[0].daily.sunrise[0],
  sunset: arr[0].daily.sunset[0],
});
