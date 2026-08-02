import { describe, expect, it } from 'vitest';
import type { LatLon } from '../domain';
import {
  MAP_BEARING_COMMIT_M,
  MAP_BEARING_DEADBAND_DEG,
  MAP_BEARING_JUMP_M,
  MapBearingGate,
} from './mapBearing';

const START: LatLon = { lat: 60, lon: 24 };
const M_PER_DEG_LAT = 111_320;
const mPerDegLon = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/** A point `northM` metres north and `eastM` metres east of `from`. */
function move(from: LatLon, northM: number, eastM: number): LatLon {
  return {
    lat: from.lat + northM / M_PER_DEG_LAT,
    lon: from.lon + eastM / mPerDegLon(from.lat),
  };
}

const FAR = MAP_BEARING_COMMIT_M + 2; // comfortably past the commit distance
const NEAR = MAP_BEARING_COMMIT_M - 6; // comfortably inside it

/** Seed the gate at START and commit `bearing`, returning the gate and the committed position. */
function committedAt(bearing: number): { gate: MapBearingGate; at: LatLon } {
  const gate = new MapBearingGate();
  gate.update(START, null);
  const at = move(START, 0, FAR);
  expect(gate.update(at, bearing)).toBeCloseTo(bearing, 6);
  return { gate, at };
}

describe('MapBearingGate', () => {
  it('holds no bearing until the rider has moved the commit distance', () => {
    const gate = new MapBearingGate();
    expect(gate.update(START, null)).toBeNull();
    // Moving, and with a known travel bearing — but not far enough to earn a commit yet.
    expect(gate.update(move(START, 0, NEAR), 90)).toBeNull();
    expect(gate.current).toBeNull();
  });

  it('commits the travel bearing once past the commit distance', () => {
    const gate = new MapBearingGate();
    gate.update(START, null);
    expect(gate.update(move(START, 0, FAR), 90)).toBeCloseTo(90, 6);
    expect(gate.current).toBeCloseTo(90, 6);
  });

  it('holds the committed bearing between commits, whatever the heading does', () => {
    const { gate, at } = committedAt(90);
    // A wild heading swing inside the commit distance must not move the map.
    expect(gate.update(move(at, 0, NEAR), 200)).toBeCloseTo(90, 6);
  });

  it('keeps the map still for a heading change inside the deadband', () => {
    const { gate, at } = committedAt(90);
    expect(gate.update(move(at, 0, FAR), 90 + MAP_BEARING_DEADBAND_DEG - 2)).toBeCloseTo(90, 6);
  });

  it('commits a heading change beyond the deadband', () => {
    const { gate, at } = committedAt(90);
    expect(gate.update(move(at, FAR, 0), 120)).toBeCloseTo(120, 6);
  });

  it('measures the deadband across 0°/360° rather than numerically', () => {
    // 355° -> 2° is a 7° turn, not a 353° one: past the deadband, so it commits.
    const past = committedAt(355);
    expect(past.gate.update(move(past.at, FAR, 0), 2)).toBeCloseTo(2, 6);
    // 355° -> 357° is inside the deadband and must hold.
    const inside = committedAt(355);
    expect(inside.gate.update(move(inside.at, FAR, 0), 357)).toBeCloseTo(355, 6);
  });

  it('normalises a committed bearing into 0..360', () => {
    const gate = new MapBearingGate();
    gate.update(START, null);
    expect(gate.update(move(START, 0, FAR), -90)).toBeCloseTo(270, 6);
  });

  it('re-anchors without committing when a fix jumps further than a rider could ride', () => {
    // GPS outage (DEC-058): the chord bearing across the gap is meaningless, so it never reaches
    // the map — the previous bearing is held until real riding resumes.
    const { gate, at } = committedAt(90);
    const jumped = move(at, MAP_BEARING_JUMP_M * 10, 0);
    expect(gate.update(jumped, 200)).toBeCloseTo(90, 6);
    // Riding on from where the outage dropped us commits normally.
    expect(gate.update(move(jumped, 0, FAR), 200)).toBeCloseTo(200, 6);
  });

  it('holds while the travel bearing is unknown', () => {
    const gate = new MapBearingGate();
    gate.update(START, null);
    expect(gate.update(move(START, 0, FAR), null)).toBeNull();
    // ...and commits as soon as the bearing becomes known, without needing to re-earn the distance.
    expect(gate.update(move(START, 0, FAR + 1), 90)).toBeCloseTo(90, 6);
  });

  it('never rotates the map while a stationary rider’s fix wanders', () => {
    const gate = new MapBearingGate();
    gate.update(START, null);
    // Fixed ±4 m wander with the wildly varying bearings such jitter produces: net displacement
    // from the anchor never reaches the commit distance, so the map is never touched.
    const wander: Array<[number, number, number]> = [
      [3, 1, 18],
      [-2, 4, 200],
      [1, -3, 95],
      [-4, -1, 310],
      [2, 2, 47],
      [-1, 3, 265],
    ];
    for (const [northM, eastM, bearing] of wander) {
      expect(gate.update(move(START, northM, eastM), bearing)).toBeNull();
    }
  });
});
