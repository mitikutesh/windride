#!/usr/bin/env vite-node
/**
 * scripts/gen-traces.ts — generate the three synthetic GPX traces (WR-012) into fixtures/traces/,
 * derived from the WR-005 ORS fixture route so snap tests (WR-013) have ground-truth progress:
 *   clean-loop.gpx      — walks the fixture loop
 *   off-route.gpx       — same loop with a ~300 m perpendicular excursion and back
 *   figure-eight.gpx    — a self-crossing lemniscate (windowed-snap stress test)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { LatLon } from '../src/domain';
import { walkPolyline } from '../src/nav/replay';
import { toGpx } from '../src/utils/gpx';

const M_PER_DEG_LAT = 111_320;
const mPerDegLon = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

const geo = JSON.parse(readFileSync('fixtures/ors/roundtrip-sample.geojson', 'utf8'));
const loop: LatLon[] = geo.features[0].geometry.coordinates.map((c: number[]) => ({
  lat: c[1],
  lon: c[0],
}));

/** Insert a ~300 m out-and-back spur perpendicular to the route near the given vertex. */
function offRoutePolyline(base: LatLon[]): LatLon[] {
  const k = Math.floor(base.length * 0.4);
  const a = base[k];
  const b = base[k + 1] ?? base[0];
  const dx = (b.lon - a.lon) * mPerDegLon(a.lat);
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const spur: LatLon = {
    lat: a.lat + (py * 300) / M_PER_DEG_LAT,
    lon: a.lon + (px * 300) / mPerDegLon(a.lat),
  };
  return [...base.slice(0, k + 1), spur, ...base.slice(k + 1)];
}

/** Lemniscate of Bernoulli around the loop's centroid — a self-crossing figure-eight. */
function figureEight(base: LatLon[]): LatLon[] {
  const cLat = base.reduce((s, p) => s + p.lat, 0) / base.length;
  const cLon = base.reduce((s, p) => s + p.lon, 0) / base.length;
  const aM = 1500; // half-width in metres
  const pts: LatLon[] = [];
  for (let i = 0; i <= 96; i++) {
    const t = (i / 96) * 2 * Math.PI;
    const denom = 1 + Math.sin(t) * Math.sin(t);
    const x = (aM * Math.cos(t)) / denom;
    const y = (aM * Math.sin(t) * Math.cos(t)) / denom;
    pts.push({ lat: cLat + y / M_PER_DEG_LAT, lon: cLon + x / mPerDegLon(cLat) });
  }
  return pts;
}

mkdirSync('fixtures/traces', { recursive: true });
const traces: Array<[string, LatLon[]]> = [
  ['clean-loop', loop],
  ['off-route', offRoutePolyline(loop)],
  ['figure-eight', figureEight(loop)],
];
for (const [name, polyline] of traces) {
  const fixes = walkPolyline(polyline, {
    speedMs: 25 / 3.6,
    startEpochMs: Date.parse('2026-07-10T09:00:00Z'),
  });
  const xml = toGpx({
    name: `WindRide ${name} trace`,
    creator: 'WindRide replay',
    points: fixes.map((f) => ({ lat: f.lat, lon: f.lon, ele: f.ele, time: f.time })),
  });
  const out = `fixtures/traces/${name}.gpx`;
  writeFileSync(out, xml);
  console.log(`wrote ${out} (${fixes.length} fixes)`);
}
