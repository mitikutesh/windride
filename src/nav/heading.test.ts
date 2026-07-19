import { describe, expect, it } from 'vitest';
import {
  blendHeading,
  circularBlend,
  HEADING_GPS_TRUST_HIGH_MS,
  HEADING_GPS_TRUST_LOW_MS,
} from './heading';

const MID_SPEED = (HEADING_GPS_TRUST_LOW_MS + HEADING_GPS_TRUST_HIGH_MS) / 2; // → weight 0.5

describe('circularBlend', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(circularBlend(0, 90, 0)).toBeCloseTo(0, 6);
    expect(circularBlend(0, 90, 1)).toBeCloseTo(90, 6);
  });
  it('interpolates the short way at t=0.5', () => {
    expect(circularBlend(0, 90, 0.5)).toBeCloseTo(45, 6);
  });
  it('wraps across 0°/360° (350° and 10° blend to 0°, not 180°)', () => {
    expect(circularBlend(350, 10, 0.5)).toBeCloseTo(0, 6);
  });
  it('clamps t outside [0,1]', () => {
    expect(circularBlend(0, 90, 2)).toBeCloseTo(90, 6);
    expect(circularBlend(0, 90, -1)).toBeCloseTo(0, 6);
  });
  it('returns the dominant endpoint (not an unstable atan2) for ~opposite angles', () => {
    // North vs south has no meaningful average — pick the higher-weight side, stably.
    expect(circularBlend(10, 190, 0.5)).toBeCloseTo(190, 6); // w ≥ 0.5 → b
    expect(circularBlend(10, 190, 0.4)).toBeCloseTo(10, 6); // w < 0.5 → a
    // A 1° nudge near-opposite must NOT flip the output ~180°.
    const near = circularBlend(10, 189, 0.5);
    expect(Math.abs(((near - 189 + 540) % 360) - 180)).toBeLessThan(5); // stays near b, no whip
  });
});

describe('blendHeading', () => {
  it('falls back to travel when the compass is unknown', () => {
    expect(blendHeading(90, null, 5)).toBe(90);
  });
  it('falls back to the compass when travel is unknown (cold start / stationary)', () => {
    expect(blendHeading(null, 270, 5)).toBe(270);
  });
  it('is null when neither source is known', () => {
    expect(blendHeading(null, null, 5)).toBeNull();
  });
  it('trusts the GPS travel bearing at cruising speed (ignores a wayward compass)', () => {
    // Phone in a bag pointing 270°, but rolling due east — the arrow must point east.
    expect(blendHeading(90, 270, HEADING_GPS_TRUST_HIGH_MS + 2)).toBeCloseTo(90, 6);
  });
  it('trusts the compass when stopped (GPS course is noise)', () => {
    expect(blendHeading(90, 270, 0)).toBeCloseTo(270, 6);
  });
  it('crossfades between the two at intermediate speed', () => {
    expect(blendHeading(0, 90, MID_SPEED)).toBeCloseTo(45, 6);
  });
  it('crossfades correctly across the 0°/360° wrap', () => {
    expect(blendHeading(350, 10, MID_SPEED)).toBeCloseTo(0, 6);
  });
  it('picks the speed-favoured source when compass and travel are opposite (no whip)', () => {
    // Accelerating from a stop with the phone pointing backwards: opposed at mid-speed.
    const span = HEADING_GPS_TRUST_HIGH_MS - HEADING_GPS_TRUST_LOW_MS;
    const fast = blendHeading(0, 180, HEADING_GPS_TRUST_LOW_MS + 0.6 * span);
    expect(fast).toBeCloseTo(0, 6); // faster ⇒ trust travel
    const slow = blendHeading(0, 180, HEADING_GPS_TRUST_LOW_MS + 0.4 * span);
    expect(slow).toBeCloseTo(180, 6); // slower ⇒ trust compass
  });
});
