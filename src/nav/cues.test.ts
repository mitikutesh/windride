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
