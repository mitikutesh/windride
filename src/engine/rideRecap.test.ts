import { describe, expect, it } from 'vitest';
import type { RideSummary } from '../domain';
import { buildRecapFacts, parseRecap, recapRequest } from './rideRecap';

const base: RideSummary = {
  distanceM: 42200,
  elapsedS: 8400, // 140 min
  movingS: 7800, // 130 min
  avgSpeedMs: 5.4, // ~19.4 km/h
};

describe('buildRecapFacts', () => {
  it('reduces a recording to grounded numbers', () => {
    const f = buildRecapFacts(base);
    expect(f.distanceKm).toBe(42.2);
    expect(f.movingMin).toBe(130);
    expect(f.elapsedMin).toBe(140);
    expect(f.restMin).toBe(10); // elapsed − moving
    expect(f.avgSpeedKmh).toBe(19.4);
    expect(f.windMix).toBeNull(); // no plan linked
    expect(f.headwindAvoidedKm).toBeNull();
  });

  it('derives the wind mix as % of time when a plan was linked', () => {
    const f = buildRecapFacts({
      ...base,
      windByKindS: { tail: 3900, cross: 1950, head: 1950 },
      headwindAvoidedKm: 4.25,
    });
    expect(f.windMix).toEqual({ tailPct: 50, crossPct: 25, headPct: 25 });
    expect(f.headwindAvoidedKm).toBe(4.3);
  });
});

describe('recapRequest', () => {
  it('grounds the prompt in the facts, demands JSON, no Strava', () => {
    const req = recapRequest(buildRecapFacts(base));
    expect(req.prompt).toContain('42.2');
    expect(req.system.toLowerCase()).toContain('json');
    expect(`${req.system} ${req.prompt}`.toLowerCase()).not.toContain('strava');
  });
});

describe('parseRecap', () => {
  const valid = {
    summary: 'Solid 42 km — mostly tailwind, nice pace.',
    highlights: ['Half the ride was tailwind.'],
  };

  it('accepts a well-formed recap', () => {
    expect(parseRecap(valid)).toEqual(valid);
  });

  it('treats highlights as optional (empty when absent)', () => {
    expect(parseRecap({ summary: 'Nice ride.' })?.highlights).toEqual([]);
  });

  it('rejects malformed responses', () => {
    expect(parseRecap(42)).toBeNull();
    expect(parseRecap({ highlights: ['x'] })).toBeNull(); // no summary
    expect(parseRecap({ summary: '' })).toBeNull();
    expect(parseRecap({ summary: 'ok', highlights: 'not an array' })).toBeNull();
  });

  it('rejects the whole response when any highlight element is malformed (no partial trust)', () => {
    expect(parseRecap({ summary: 'ok', highlights: ['fine', 42] })).toBeNull();
    expect(parseRecap({ summary: 'ok', highlights: ['fine', { eta: 'beat it' }] })).toBeNull();
    expect(parseRecap({ summary: 'ok', highlights: ['fine', ''] })).toBeNull();
  });

  it('caps highlight count', () => {
    const out = parseRecap({
      summary: 'ok',
      highlights: Array.from({ length: 10 }, (_v, i) => `h${i}`),
    });
    expect(out!.highlights.length).toBeLessThanOrEqual(4);
  });
});
