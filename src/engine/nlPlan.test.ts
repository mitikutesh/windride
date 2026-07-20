import { describe, expect, it } from 'vitest';
import { nlPlanRequest, parseNlPlan } from './nlPlan';

describe('parseNlPlan', () => {
  it('extracts + clamps a full request', () => {
    const nl = parseNlPlan({
      distanceKm: 42,
      routeType: 'loop',
      surface: 'gravel',
      homeBeforeDark: true,
      avoidBusy: true,
      winter: false,
      departureHour: 4,
      summary: 'A 40 km gravel loop on quiet roads, back before dark.',
    });
    expect(nl?.patch).toEqual({
      distanceKm: 40, // 42 snapped to the 5 km step
      routeType: 'loop',
      surface: 'gravel',
      homeBeforeDark: true,
      avoidBusy: true,
      winter: false,
      departureHour: 3, // 4 → nearest of {0,3,6}
    });
    expect(nl?.summary).toContain('gravel loop');
  });

  it('clamps distance into 20–100', () => {
    expect(parseNlPlan({ distanceKm: 7 })?.patch.distanceKm).toBe(20);
    expect(parseNlPlan({ distanceKm: 250 })?.patch.distanceKm).toBe(100);
  });

  it('converts a stated duration to distance via the base speed (not naive generic math)', () => {
    // 120 min on road at the supplied 30 km/h base → 60 km
    const road = parseNlPlan({ durationMin: 120, surface: 'road' }, { roadKmh: 30, gravelKmh: 20 });
    expect(road?.patch.distanceKm).toBe(60);
    // gravel uses the slower gravel base speed → 40 km
    const gravel = parseNlPlan(
      { durationMin: 120, surface: 'gravel' },
      { roadKmh: 30, gravelKmh: 20 },
    );
    expect(gravel?.patch.distanceKm).toBe(40);
  });

  it('prefers an explicit distance over a stated duration', () => {
    const nl = parseNlPlan({ distanceKm: 80, durationMin: 60 }, { roadKmh: 30, gravelKmh: 20 });
    expect(nl?.patch.distanceKm).toBe(80);
  });

  it('uses the DEC-004 default base speed when none is supplied', () => {
    expect(parseNlPlan({ durationMin: 120 })?.patch.distanceKm).toBe(55); // 2h × 27 = 54 → snap 55
  });

  it('drops fields with invalid enums or wrong types, keeping the valid ones', () => {
    const nl = parseNlPlan({ routeType: 'zigzag', surface: 'gravel', avoidBusy: 'yes' });
    expect(nl?.patch).toEqual({ surface: 'gravel' }); // bad routeType + non-boolean avoidBusy dropped
  });

  it('rejects a response with no usable field', () => {
    expect(parseNlPlan({ routeType: 'nonsense', foo: 1 })).toBeNull();
    expect(parseNlPlan({})).toBeNull();
    expect(parseNlPlan(42)).toBeNull();
  });

  it('tolerates a missing summary (empty string)', () => {
    expect(parseNlPlan({ surface: 'road' })?.summary).toBe('');
  });
});

describe('nlPlanRequest', () => {
  it('lists the allowed values, demands JSON, and never mentions Strava', () => {
    const req = nlPlanRequest('a hilly road ride');
    expect(req.system).toContain('out-and-back');
    expect(req.system.toLowerCase()).toContain('json');
    expect(req.prompt).toContain('a hilly road ride');
    expect(`${req.system} ${req.prompt}`.toLowerCase()).not.toContain('strava');
  });
});
