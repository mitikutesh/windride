import { describe, expect, it } from 'vitest';
import { discoveryRequest, parseDiscoveries } from './discovery';

describe('parseDiscoveries', () => {
  it('keeps valid ideas and normalises the bearing into 0–359', () => {
    const out = parseDiscoveries({
      ideas: [
        { name: 'NW lakes', note: 'forest + gravel', bearingDeg: 315 },
        { name: 'Coast', note: 'sea views', bearingDeg: 370 }, // wraps to 10
      ],
    });
    expect(out).toHaveLength(2);
    expect(out?.[0].bearingDeg).toBe(315);
    expect(out?.[1].bearingDeg).toBe(10);
  });

  it('drops ideas missing a field or with a non-numeric bearing', () => {
    const out = parseDiscoveries({
      ideas: [
        { name: 'ok', note: 'nice', bearingDeg: 90 },
        { name: '', note: 'x', bearingDeg: 45 }, // empty name
        { name: 'no bearing', note: 'x' },
        { name: 'bad bearing', note: 'x', bearingDeg: 'north' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out?.[0].name).toBe('ok');
  });

  it('rejects a non-object, a missing ideas array, or an all-invalid list', () => {
    expect(parseDiscoveries(42)).toBeNull();
    expect(parseDiscoveries({})).toBeNull();
    expect(parseDiscoveries({ ideas: [] })).toBeNull();
    expect(parseDiscoveries({ ideas: [{ name: 'x' }] })).toBeNull();
  });

  it('caps at 6 ideas', () => {
    const many = Array.from({ length: 10 }, (_v, i) => ({
      name: `n${i}`,
      note: 'x',
      bearingDeg: i * 10,
    }));
    expect(parseDiscoveries({ ideas: many })?.length).toBe(6);
  });
});

describe('discoveryRequest', () => {
  it('includes distance + surface, demands JSON, and never mentions Strava', () => {
    const req = discoveryRequest('60.1, 24.6', 45, 'gravel');
    expect(req.prompt).toContain('45');
    expect(req.prompt).toContain('gravel');
    expect(req.system.toLowerCase()).toContain('json');
    expect(`${req.system} ${req.prompt}`.toLowerCase()).not.toContain('strava');
  });
});
