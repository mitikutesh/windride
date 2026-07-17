import { describe, expect, it } from 'vitest';
import { decompose } from './wind';

describe('wind decomposition (SCORING_SPEC §2 must-pass cases)', () => {
  it('bearing 45, wind_from 225, W 8 => pure tailwind (v_par +8, v_cross 0)', () => {
    const w = decompose(45, 225, 8);
    expect(w.windToDeg).toBe(45);
    expect(w.deltaDeg).toBeCloseTo(0);
    expect(w.vParMs).toBeCloseTo(8);
    expect(w.vCrossMs).toBeCloseTo(0);
  });

  it('bearing 45, wind_from 45 => pure headwind (v_par -8)', () => {
    const w = decompose(45, 45, 8);
    expect(w.deltaDeg).toBeCloseTo(180);
    expect(w.vParMs).toBeCloseTo(-8);
    expect(w.vCrossMs).toBeCloseTo(0);
  });

  it('bearing 45, wind_from 135 => pure crosswind (v_par 0, v_cross 8)', () => {
    const w = decompose(45, 135, 8);
    expect(w.deltaDeg).toBeCloseTo(90);
    expect(w.vParMs).toBeCloseTo(0);
    expect(w.vCrossMs).toBeCloseTo(8);
  });

  it('scales by exposure and carries gust', () => {
    const w = decompose(45, 225, 8, 0.5, 12);
    expect(w.effectiveMs).toBeCloseTo(4);
    expect(w.vParMs).toBeCloseTo(4);
    expect(w.gustEffMs).toBeCloseTo(6);
  });
});
