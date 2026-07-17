import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEED_SETTINGS,
  segmentSpeedKmh,
  segmentTimeS,
  type SpeedSettings,
} from './speedModel';

const physics: SpeedSettings = { ...DEFAULT_SPEED_SETTINGS, model: 'physics' };

describe('speedModel — base sanity (SCORING_SPEC §3, DEC-004)', () => {
  it('rides paved base speed in still air on the flat', () => {
    expect(segmentSpeedKmh('paved', 0, 0)).toBeCloseTo(27);
    expect(segmentSpeedKmh('gravel', 0, 0)).toBeCloseTo(21);
  });

  it('tailwind speeds up and headwind slows down (linear)', () => {
    expect(segmentSpeedKmh('paved', 0, 5)).toBeGreaterThan(27);
    expect(segmentSpeedKmh('paved', 0, -5)).toBeLessThan(27);
  });

  it('segmentTimeS derives duration from the speed model', () => {
    expect(segmentTimeS(1000, 36)).toBeCloseTo(100); // 36 km/h = 10 m/s -> 100 s / km
  });
});

describe('speedModel — monotonicity (both models)', () => {
  for (const s of [DEFAULT_SPEED_SETTINGS, physics]) {
    it(`more headwind never increases speed (${s.model})`, () => {
      // Sweep a wide range (±15 m/s) so a strong tailwind can't spuriously slow the physics model.
      let prev = Infinity;
      for (let vPar = 15; vPar >= -15; vPar -= 1) {
        const v = segmentSpeedKmh('paved', 0, vPar, s);
        expect(v).toBeLessThanOrEqual(prev + 1e-9);
        prev = v;
      }
    });

    it(`steeper climb never increases speed (${s.model})`, () => {
      // SCORING_SPEC §3 guarantees monotonicity on CLIMBS (grade >= 0). The linear MVP's downhill
      // term is a small speed reduction per the spec, so we assert only the uphill range.
      let prev = Infinity;
      for (let grade = 0; grade <= 12; grade += 1) {
        const v = segmentSpeedKmh('paved', grade, 0, s);
        expect(v).toBeLessThanOrEqual(prev + 1e-9);
        prev = v;
      }
    });
  }

  it('speeds stay within the configured clamp', () => {
    expect(segmentSpeedKmh('paved', -30, 40)).toBeLessThanOrEqual(DEFAULT_SPEED_SETTINGS.maxKmh);
    expect(segmentSpeedKmh('paved', 30, -40)).toBeGreaterThanOrEqual(DEFAULT_SPEED_SETTINGS.minKmh);
  });
});
