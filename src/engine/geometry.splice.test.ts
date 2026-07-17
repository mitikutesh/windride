import { describe, expect, it } from 'vitest';
import type { CandidateRoute, LatLon, TurnStep } from '../domain';
import { polylineLengthM, resample, spliceRoute } from './geometry';

/** A straight 9-point route heading north (~890 m), with depart/turn/arrival steps. */
function makeRoute(): CandidateRoute {
  const polyline: LatLon[] = Array.from({ length: 9 }, (_, i) => ({
    lat: 60 + i * 0.001,
    lon: 24,
  }));
  const steps: TurnStep[] = [
    { instruction: 'Head north', distanceM: 220, type: 11, wayPoints: [0, 2] },
    { instruction: 'Turn left onto X', distanceM: 220, type: 0, wayPoints: [4, 6] },
    { instruction: 'Arrive at destination', distanceM: 0, type: 10, wayPoints: [8, 8] },
  ];
  return {
    id: 'route',
    polyline,
    segments: resample({ polyline }),
    distanceM: polylineLengthM(polyline),
    ascentM: 0,
    steps,
  };
}

/** A short detour leg from an off-route point back toward the route. */
function makeLeg(points: LatLon[]): CandidateRoute {
  return {
    id: 'leg',
    polyline: points,
    segments: resample({ polyline: points }),
    distanceM: polylineLengthM(points),
    ascentM: 0,
    steps: [
      { instruction: 'Head to route', distanceM: 50, type: 11, wayPoints: [0, 1] },
      { instruction: 'Turn right onto detour', distanceM: 50, type: 1, wayPoints: [1, 2] },
    ],
  };
}

const atM = 400;

describe('spliceRoute', () => {
  const route = makeRoute();
  const total = route.distanceM;

  it('preserves the finish point and everything downstream of the rejoin', () => {
    const leg = makeLeg([
      { lat: 60.0025, lon: 24.004 }, // off-route current position
      { lat: 60.0033, lon: 24.002 },
      { lat: 60.0036, lon: 24 }, // ~ the rejoin point at 400 m
    ]);
    const spliced = spliceRoute(route, atM, leg);
    // Finish identical.
    expect(spliced.polyline.at(-1)).toEqual(route.polyline.at(-1));
    // Segments still tile the route: Σ lengthM == distanceM (the ETA/wind model needs full cover).
    const segSum = spliced.segments.reduce((s, seg) => s + seg.lengthM, 0);
    expect(segSum).toBeCloseTo(spliced.distanceM, 3);
    // Later downstream segments preserved by identity (only the straddler is trimmed/new).
    expect(route.segments.some((s) => spliced.segments.includes(s))).toBe(true);
    // Remaining distance = leg + untouched downstream; never a shortcut to the finish.
    expect(spliced.distanceM).toBeCloseTo(leg.distanceM + (total - atM), 3);
    expect(spliced.distanceM).toBeGreaterThan(total - atM);
  });

  it("strips the leg's arrival step so it isn't announced mid-ride at the rejoin", () => {
    const leg = makeLeg([
      { lat: 60.0025, lon: 24.004 },
      { lat: 60.0036, lon: 24 },
    ]);
    leg.steps = [
      { instruction: 'Head to route', distanceM: 50, type: 11, wayPoints: [0, 1] },
      { instruction: 'Arrive at rejoin', distanceM: 0, type: 10, wayPoints: [1, 1] },
    ];
    const spliced = spliceRoute(route, atM, leg);
    const arrivals = (spliced.steps ?? []).filter((s) => s.type === 10);
    // Only the ORIGINAL route's arrival survives, not the leg's.
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].instruction).toBe('Arrive at destination');
  });

  it('re-indexes downstream steps into the new polyline and keeps arrival', () => {
    const leg = makeLeg([
      { lat: 60.0025, lon: 24.004 },
      { lat: 60.0036, lon: 24 },
    ]);
    const spliced = spliceRoute(route, atM, leg);
    const stepInstructions = (spliced.steps ?? []).map((s) => s.instruction);
    expect(stepInstructions).toContain('Turn left onto X');
    expect(stepInstructions).toContain('Arrive at destination');
    expect(stepInstructions).not.toContain('Head north'); // pre-rejoin step dropped
    // Every waypoint index is within the new polyline.
    for (const s of spliced.steps ?? []) {
      if (!s.wayPoints) continue;
      expect(s.wayPoints[0]).toBeGreaterThanOrEqual(0);
      expect(s.wayPoints[1]).toBeLessThan(spliced.polyline.length);
    }
  });

  it('handles a leg shorter or longer than the replaced gap, finish stays put', () => {
    const short = spliceRoute(
      route,
      atM,
      makeLeg([
        { lat: 60.0035, lon: 24.0005 },
        { lat: 60.0036, lon: 24 },
      ]),
    );
    const long = spliceRoute(
      route,
      atM,
      makeLeg([
        { lat: 60.0025, lon: 24.02 }, // a big loop back
        { lat: 60.006, lon: 24.02 },
        { lat: 60.0036, lon: 24 },
      ]),
    );
    for (const spliced of [short, long]) {
      expect(spliced.polyline.at(-1)).toEqual(route.polyline.at(-1)); // finish identical
      expect(spliced.distanceM).toBeGreaterThan(total - atM); // downstream always preserved
    }
    expect(long.distanceM).toBeGreaterThan(short.distanceM);
  });
});
