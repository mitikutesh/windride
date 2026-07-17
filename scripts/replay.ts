#!/usr/bin/env vite-node
/**
 * scripts/replay.ts — `npm run replay -- <file> [--speed 10] [--jitter 8]`.
 * Streams a GPX trace as fixes with real (scaled) timing; --jitter adds gaussian metres of noise.
 */
import { readFileSync } from 'node:fs';
import { mulberry32, parseTraceToFixes, ReplaySource } from '../src/nav/replay';

const args = process.argv.slice(2);
const argVal = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const usage = 'usage: npm run replay -- <file.gpx> [--speed N] [--jitter metres] [--seed N]';
const file = args.find((a) => !a.startsWith('--') && a.endsWith('.gpx'));
if (!file) {
  console.error(usage);
  process.exit(1);
}
const speed = Number(argVal('--speed') ?? 1);
const jitterM = Number(argVal('--jitter') ?? 0);
const seed = Number(argVal('--seed') ?? 1);
if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(jitterM) || jitterM < 0) {
  console.error(`invalid --speed/--jitter.\n${usage}`);
  process.exit(1);
}

const fixes = parseTraceToFixes(readFileSync(file, 'utf8'));
console.log(`Replaying ${fixes.length} fixes from ${file} at ${speed}x (jitter ${jitterM} m)…`);

const source = new ReplaySource(fixes, { speed, jitterM, rng: mulberry32(seed) });
let n = 0;
source.start((fix) => {
  n++;
  const speedKmh = ((fix.speed ?? 0) * 3.6).toFixed(1);
  console.log(
    `${String(n).padStart(4)}/${fixes.length}  ${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}  ${speedKmh} km/h  ${fix.time}`,
  );
  if (n === fixes.length) console.log('Replay complete.');
});
