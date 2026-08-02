import { describe, expect, it } from 'vitest';
import cleanLoopGpx from '../../fixtures/traces/clean-loop.gpx?raw';
import cleanRouteRaw from '../../fixtures/traces/clean-loop-route.json?raw';
import geoRaw from '../../fixtures/ors/roundtrip-sample.geojson?raw';
import type { LatLon, TurnStep } from '../domain';
import { parseTraceToFixes } from './replay';
import { prepareTrack, Snapper } from './snap';
import {
  buildCuePoints,
  CueScheduler,
  CUE_NOMINAL_SPEED_MS,
  MANEUVER_GRACE_M,
  nextManeuver,
  proximityToManeuverM,
  scaledTriggerDistanceM,
  type Cue,
  type CuePoint,
} from './cues';

const cleanRoute = JSON.parse(cleanRouteRaw) as LatLon[];

/** The WR-005 fixture's steps, parsed the way the ORS adapter builds them. */
function fixtureSteps(): TurnStep[] {
  const geo = JSON.parse(geoRaw) as {
    features: { properties: { segments: { steps: Record<string, unknown>[] }[] } }[];
  };
  return geo.features[0].properties.segments.flatMap((seg) =>
    seg.steps.map((s) => ({
      instruction: s.instruction as string,
      distanceM: s.distance as number,
      type: s.type as number,
      wayPoints: s.way_points as [number, number],
    })),
  );
}

describe('scaledTriggerDistanceM', () => {
  it('is the base at nominal speed and clamps to ±40%', () => {
    expect(scaledTriggerDistanceM(200, CUE_NOMINAL_SPEED_MS)).toBeCloseTo(200, 5);
    expect(scaledTriggerDistanceM(200, 100)).toBeCloseTo(280, 5); // fast -> +40% (earlier)
    expect(scaledTriggerDistanceM(200, 0.01)).toBeCloseTo(120, 5); // slow -> -40%
    expect(scaledTriggerDistanceM(200, 0)).toBeCloseTo(120, 5); // stopped -> floor
  });
});

describe('buildCuePoints', () => {
  it('skips the depart step and binds the turn to its waypoint distance', () => {
    const track = prepareTrack(cleanRoute);
    const cues = buildCuePoints(fixtureSteps(), track);
    expect(cues).toHaveLength(1); // "Head east" (type 11) dropped, "Turn left" kept
    expect(cues[0].instruction).toBe('Turn left onto Metsapolku');
    expect(cues[0].turnDistanceM).toBeCloseTo(track.cum[2], 6); // way_points[0] === 2
  });
});

describe('proximityToManeuverM (WR-055 junction zoom)', () => {
  const cue = (stepIndex: number, turnDistanceM: number, type?: number): CuePoint => ({
    stepIndex,
    turnDistanceM,
    instruction: 'Turn left onto X',
    type,
  });

  it('is null when the route has no steps at all (curated and AI routes)', () => {
    expect(proximityToManeuverM([], 500)).toBeNull();
  });

  it('measures the distance to the nearest maneuver ahead', () => {
    const cues = [cue(1, 400, 0), cue(2, 1200, 0)];
    expect(proximityToManeuverM(cues, 250)).toBeCloseTo(150, 6);
    expect(proximityToManeuverM(cues, 900)).toBeCloseTo(300, 6); // the second one now
  });

  it('stays at zero through the grace window past a node, then lets go', () => {
    const cues = [cue(1, 400, 0)];
    expect(proximityToManeuverM(cues, 400)).toBe(0); // on it
    expect(proximityToManeuverM(cues, 400 + MANEUVER_GRACE_M - 5)).toBe(0); // mid-corner
    // Past the grace with nothing else ahead: not near a junction any more.
    expect(proximityToManeuverM(cues, 400 + MANEUVER_GRACE_M + 5)).toBeNull();
  });

  it('does NOT treat a node as near once it is well behind — the asymmetry that keeps look-ahead', () => {
    // A symmetric |distance| would report 150 m here and pin the junction zoom on every urban route.
    expect(proximityToManeuverM([cue(1, 400, 0)], 550)).toBeNull();
  });

  it('skips the arrival step and "continue straight", keeps forks and turnarounds', () => {
    expect(proximityToManeuverM([{ ...cue(1, 400, 10), instruction: 'Arrive' }], 300)).toBeNull();
    expect(proximityToManeuverM([cue(1, 400, 6)], 300)).toBeNull(); // 6 = continue straight
    expect(proximityToManeuverM([cue(1, 400, 12)], 300)).toBeCloseTo(100, 6); // keep left
    expect(proximityToManeuverM([cue(1, 400, 9)], 300)).toBeCloseTo(100, 6); // turnaround
  });

  it('prefers the nearer of two maneuvers straddling the rider', () => {
    const cues = [cue(1, 400, 0), cue(2, 460, 0)];
    expect(proximityToManeuverM(cues, 430)).toBe(0); // 400 is 30 m behind, inside the grace
    expect(proximityToManeuverM(cues, 380)).toBeCloseTo(20, 6);
  });
});

describe('nextManeuver (WR-057 junction arrow)', () => {
  const cue = (stepIndex: number, turnDistanceM: number, type: number): CuePoint => ({
    stepIndex,
    turnDistanceM,
    instruction: 'Turn left onto X',
    type,
  });

  it('finds the next junction the rider steers through', () => {
    const cues = [cue(1, 400, 0), cue(2, 900, 1)];
    expect(nextManeuver(cues, 100)?.stepIndex).toBe(1);
    expect(nextManeuver(cues, 500)?.stepIndex).toBe(2);
    expect(nextManeuver(cues, 950)).toBeUndefined();
  });

  it('skips what is not a junction: the finish, and "continue straight"', () => {
    // Without this the finish line would get a turn arrow drawn on it.
    expect(nextManeuver([{ ...cue(1, 400, 10), instruction: 'Arrive' }], 0)).toBeUndefined();
    expect(nextManeuver([cue(1, 400, 6)], 0)).toBeUndefined();
  });

  it('skips a follower folded into its predecessor', () => {
    const folded: CuePoint[] = [cue(1, 400, 0), { ...cue(2, 406, 1), suppress: 'all' }];
    expect(nextManeuver(folded, 401)).toBeUndefined(); // same junction, already passed
  });

  it('returns nothing at all for a route with no steps', () => {
    expect(nextManeuver([], 0)).toBeUndefined();
  });
});

// WR-056: on a real 22.5 km ORS capture, 43 of 120 maneuvers sit within CUE_CHAIN_M of the previous
// one (23 within CUE_MERGE_M). Unchained, the rider hears the follower's PREPARE ~150 m before the
// leader's turn, then both turns on the same tick.
describe('chained maneuvers (WR-056)', () => {
  const step = (instruction: string, atM: number, type: number): TurnStep => ({
    instruction,
    distanceM: 0,
    type,
    wayPoints: [atM, atM],
  });
  /** A straight 1 m-per-index track, so a step's wayPoint index IS its distance in metres. */
  const metreTrack = () =>
    prepareTrack(
      Array.from({ length: 1500 }, (_v, i) => ({
        lat: 60,
        lon: 24 + i / (111_320 * Math.cos(Math.PI / 3)),
      })),
    );

  /** Everything the scheduler says for a cue set, riding past all of it. */
  function ride(cues: CuePoint[], toM = 1400): Cue[] {
    const s = new CueScheduler(cues);
    const fired: Cue[] = [];
    for (let m = 0; m <= toM; m += 5) fired.push(...s.update(m, CUE_NOMINAL_SPEED_MS));
    return fired;
  }

  it('folds a same-junction follower into the leader and never announces it', () => {
    const cues = buildCuePoints(
      [step('Keep left', 1000, 12), step('Turn left onto Metsapolku', 1008, 0)],
      metreTrack(),
    );
    expect(cues[1].suppress).toBe('all');
    const fired = ride(cues);
    // Only the leader speaks — but its direction hint carries the follower, so nothing is lost.
    expect(fired.every((c) => c.stepIndex === 0)).toBe(true);
    expect(fired.map((c) => c.kind)).toEqual(['prepare', 'turn']);
    for (const c of fired) expect(c.text).toMatch(/, then left$/);
  });

  it('drops only the PREPARE of a follower 50 m on, keeping its own turn cue', () => {
    const cues = buildCuePoints(
      [step('Turn left onto A', 1000, 0), step('Turn right onto B', 1050, 1)],
      metreTrack(),
    );
    expect(cues[1].suppress).toBe('prepare');
    const fired = ride(cues);
    // Exactly one prepare — the stacked second one is gone...
    const prepares = fired.filter((c) => c.kind === 'prepare');
    expect(prepares).toHaveLength(1);
    expect(prepares[0].stepIndex).toBe(0);
    expect(prepares[0].text).toMatch(/, then right$/);
    // ...and both turns are still announced, in order.
    expect(fired.filter((c) => c.kind === 'turn').map((c) => c.stepIndex)).toEqual([0, 1]);
  });

  it('leaves well-separated maneuvers completely alone', () => {
    const cues = buildCuePoints(
      [step('Turn left onto A', 700, 0), step('Turn right onto B', 1100, 1)],
      metreTrack(),
    );
    expect(cues.some((c) => c.suppress)).toBe(false);
    const fired = ride(cues);
    expect(fired.map((c) => `${c.kind}:${c.stepIndex}`)).toEqual([
      'prepare:0',
      'turn:0',
      'prepare:1',
      'turn:1',
    ]);
    for (const c of fired) expect(c.text).not.toMatch(/, then /);
  });

  it('composes over a run of three, judging each against what the rider last HEARD', () => {
    const cues = buildCuePoints(
      [
        step('Turn left onto A', 1000, 0),
        step('Turn right onto B', 1040, 1),
        step('Turn right onto C', 1080, 1),
      ],
      metreTrack(),
    );
    // Each is 40 m from the previous ANNOUNCED maneuver, so each keeps its own turn cue.
    expect(cues.map((c) => c.suppress)).toEqual([undefined, 'prepare', 'prepare']);
    const fired = ride(cues);
    expect(fired.filter((c) => c.kind === 'prepare')).toHaveLength(1);
    expect(fired.filter((c) => c.kind === 'turn').map((c) => c.stepIndex)).toEqual([0, 1, 2]);
    // Only the FIRST follower is named — "left, then right, then right" would be noise.
    expect(fired[0].text).toMatch(/, then right$/);
  });

  it('mentions only one follower even when several share the junction', () => {
    const cues = buildCuePoints(
      [
        step('Keep left', 1000, 12),
        step('Turn left onto A', 1006, 0),
        step('Keep right', 1012, 13),
      ],
      metreTrack(),
    );
    expect(cues.map((c) => c.suppress)).toEqual([undefined, 'all', 'all']);
    const fired = ride(cues);
    expect(fired.every((c) => c.stepIndex === 0)).toBe(true);
    for (const c of fired) expect(c.text.match(/, then /g)).toHaveLength(1);
  });
});

describe('CueScheduler — one-shot firing + templates', () => {
  const cp: CuePoint = {
    stepIndex: 1,
    turnDistanceM: 1000,
    instruction: 'Turn left onto Rantaraitti',
    type: 0,
  };

  it('fires prepare then turn, each exactly once, with the spec templates', () => {
    const s = new CueScheduler([cp]);
    expect(s.update(700, CUE_NOMINAL_SPEED_MS)).toEqual([]); // 300 m out, before the 200 m prepare
    const prep = s.update(820, CUE_NOMINAL_SPEED_MS); // 180 m out -> prepare
    expect(prep).toHaveLength(1);
    expect(prep[0]).toMatchObject({ kind: 'prepare', stepIndex: 1 });
    expect(prep[0].text).toBe('In 200 metres, left onto Rantaraitti');
    expect(s.update(900, CUE_NOMINAL_SPEED_MS)).toEqual([]); // prepare already fired, turn not yet
    const turn = s.update(965, CUE_NOMINAL_SPEED_MS); // 35 m out -> turn
    expect(turn).toHaveLength(1);
    expect(turn[0]).toMatchObject({ kind: 'turn' });
    expect(turn[0].text).toBe('Turn left now');
    expect(s.update(1005, CUE_NOMINAL_SPEED_MS)).toEqual([]); // no re-fire past the turn
  });

  it('suppresses the prepare cue if the turn is reached in the same tick', () => {
    const s = new CueScheduler([cp]);
    const out = s.update(970, CUE_NOMINAL_SPEED_MS); // jumped past both triggers
    expect(out.map((c) => c.kind)).toEqual(['turn']);
  });

  it('stays silent for a turn already ridden well past (stale progress jump)', () => {
    const s = new CueScheduler([cp]); // turn at 1000 m
    expect(s.update(1300, CUE_NOMINAL_SPEED_MS)).toEqual([]); // 300 m past -> no stale "turn now"
    expect(s.update(1400, CUE_NOMINAL_SPEED_MS)).toEqual([]); // and never re-fires
  });

  it('formats distances in imperial when requested', () => {
    const s = new CueScheduler([cp], 'imperial');
    const prep = s.update(820, CUE_NOMINAL_SPEED_MS); // 180 m ~= 591 ft
    expect(prep[0].text).toBe('In 600 feet, left onto Rantaraitti');
  });

  it('speaks arrival cues', () => {
    const arrival: CuePoint = {
      stepIndex: 2,
      turnDistanceM: 500,
      instruction: 'Arrive at your destination',
      type: 10,
    };
    const s = new CueScheduler([arrival]);
    expect(s.update(320, CUE_NOMINAL_SPEED_MS)[0].text).toBe("In 200 metres, you'll arrive");
    expect(s.update(465, CUE_NOMINAL_SPEED_MS)[0].text).toBe('You have arrived');
  });

  // WR-054: the fold of an out-and-back. It must never read as an arrival, and must not fall through
  // to shortenInstruction (which strips the leading verb: "In 200 metres, around and ride back").
  it('speaks the out-and-back fold as a turnaround, not an arrival', () => {
    const fold: CuePoint = {
      stepIndex: 3,
      turnDistanceM: 500,
      instruction: 'Turn around and ride back',
      type: 9,
    };
    const s = new CueScheduler([fold]);
    expect(s.update(320, CUE_NOMINAL_SPEED_MS)[0].text).toBe(
      'In 200 metres, turn around and ride back',
    );
    expect(s.update(465, CUE_NOMINAL_SPEED_MS)[0].text).toBe('Turn around now');
  });

  it('recognises a turnaround from the maneuver code alone, whatever the locale says', () => {
    const fold: CuePoint = {
      stepIndex: 3,
      turnDistanceM: 500,
      instruction: 'Käänny takaisin',
      type: 9,
    };
    expect(new CueScheduler([fold]).update(465, CUE_NOMINAL_SPEED_MS)[0].text).toBe(
      'Turn around now',
    );
  });

  it('rearms after a reroute: past cues stay silent, new ones fire', () => {
    const s = new CueScheduler([cp]);
    s.update(820, CUE_NOMINAL_SPEED_MS); // prepare for the old step fired
    const behind: CuePoint = { stepIndex: 4, turnDistanceM: 600, instruction: 'Turn left onto Y' };
    const ahead: CuePoint = {
      stepIndex: 5,
      turnDistanceM: 1200,
      instruction: 'Turn right onto Z',
      type: 1,
    };
    s.rearm([behind, ahead], 820);
    expect(s.update(900, CUE_NOMINAL_SPEED_MS)).toEqual([]); // behind suppressed, ahead not yet
    const p = s.update(1010, CUE_NOMINAL_SPEED_MS); // ahead prepare (1200 - 200 = 1000)
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ stepIndex: 5, kind: 'prepare' });
  });
});

describe('CueScheduler — replay integration (clean loop)', () => {
  it('produces the exact ordered one-shot cue sequence for the fixture steps', () => {
    const track = prepareTrack(cleanRoute);
    const snapper = new Snapper(track);
    const scheduler = new CueScheduler(buildCuePoints(fixtureSteps(), track));
    const fired: Cue[] = [];
    for (const fix of parseTraceToFixes(cleanLoopGpx)) {
      const { progressM } = snapper.update(fix);
      fired.push(...scheduler.update(progressM, fix.speed ?? CUE_NOMINAL_SPEED_MS));
    }
    expect(fired.map((c) => `${c.kind}:${c.stepIndex}`)).toEqual(['prepare:1', 'turn:1']);
    expect(fired[0].text).toMatch(/^In \d+ metres, left onto Metsapolku$/);
    expect(fired[1].text).toBe('Turn left now');
  });
});
