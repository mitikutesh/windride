import { lineString, pointToLineDistance } from '@turf/turf';
import { describe, expect, it } from 'vitest';
import cleanLoopGpx from '../../fixtures/traces/clean-loop.gpx?raw';
import figureEightGpx from '../../fixtures/traces/figure-eight.gpx?raw';
import offRouteGpx from '../../fixtures/traces/off-route.gpx?raw';
import cleanRouteRaw from '../../fixtures/traces/clean-loop-route.json?raw';
import figureRouteRaw from '../../fixtures/traces/figure-eight-route.json?raw';
import type { LatLon } from '../domain';
import { haversineM } from '../engine/geometry';
import { parseTraceToFixes } from './replay';

const cleanRoute = JSON.parse(cleanRouteRaw) as LatLon[];
const figureRoute = JSON.parse(figureRouteRaw) as LatLon[];

describe('synthetic trace fixtures (WR-012 ground truth)', () => {
  it('parses the expected fix counts', () => {
    expect(parseTraceToFixes(cleanLoopGpx)).toHaveLength(577);
    expect(parseTraceToFixes(offRouteGpx)).toHaveLength(629);
    expect(parseTraceToFixes(figureEightGpx)).toHaveLength(1132);
  });

  it('clean loop closes (first fix ≈ last fix)', () => {
    const f = parseTraceToFixes(cleanLoopGpx);
    expect(haversineM(f[0], f[f.length - 1])).toBeLessThan(5);
  });

  it('off-route excursion peaks near 300 m off the clean route and returns', () => {
    const line = lineString(cleanRoute.map((p) => [p.lon, p.lat]));
    const dists = parseTraceToFixes(offRouteGpx).map((f) =>
      pointToLineDistance([f.lon, f.lat], line, { units: 'meters' }),
    );
    expect(Math.max(...dists)).toBeGreaterThan(250);
    expect(Math.max(...dists)).toBeLessThan(360);
    expect(dists[0]).toBeLessThan(60); // starts on-route
    expect(dists[dists.length - 1]).toBeLessThan(60); // returns to route
  });

  it('figure-eight self-crosses (two far-apart route vertices coincide)', () => {
    const gap = Math.floor(figureRoute.length / 4); // only compare far-apart vertices
    let minFar = Infinity;
    for (let i = 0; i < figureRoute.length; i++) {
      for (let j = i + gap; j < figureRoute.length; j++) {
        minFar = Math.min(minFar, haversineM(figureRoute[i], figureRoute[j]));
      }
    }
    expect(minFar).toBeLessThan(60); // the crossing point
  });
});
