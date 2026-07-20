import { describe, expect, it } from 'vitest';
import {
  briefingRequest,
  buildBriefingFacts,
  parseBriefing,
  type BriefingConditions,
} from './briefing';
import type { ScoredCandidate } from './scoring';

// A minimal scored route — only the fields buildBriefingFacts reads (evidence + analysis.totalTimeS).
const scored = {
  evidence: {
    distanceKm: 42.2,
    ascentM: 380,
    gravelKm: 10.4,
    headwindKm: 12.1,
    tailwindKm: 9.7,
    gustyKm: 3.3,
    maxGustMs: 14.2,
  },
  analysis: { totalTimeS: 7800 }, // 2 h 10 m
} as unknown as ScoredCandidate;

const cond: BriefingConditions = {
  tempC: 12,
  feelsC: 9,
  windMs: 8,
  windFromDeg: 225,
  gustMs: 13,
  precipProb: 20, // percent, app-wide convention
  sunset: '2026-07-20T22:00:00Z',
};
const rideStart = Date.parse('2026-07-20T18:00:00Z'); // ETA 20:10Z, sunset 22:00Z → 110 min margin

// The exact set of fields allowed to reach the prompt — a regression guard so nothing un-whitelisted
// (a route name, a coordinate, anything Strava-derived) can be added to BriefingFacts unnoticed.
const FACT_KEYS = [
  'ascentM',
  'daylightMarginMin',
  'distanceKm',
  'durationMin',
  'feelsC',
  'gravelKm',
  'gustMs',
  'gustyKm',
  'headwindKm',
  'ice',
  'maxGustMs',
  'pavedKm',
  'rainChancePct',
  'tailwindKm',
  'tempC',
  'windFromCompass',
  'windFromDeg',
  'windMs',
];

describe('buildBriefingFacts', () => {
  it('reduces a scored route + conditions to grounded numbers', () => {
    const f = buildBriefingFacts(scored, cond, rideStart);
    expect(f.distanceKm).toBe(42.2);
    expect(f.durationMin).toBe(130);
    expect(f.pavedKm).toBe(31.8); // 42.2 − 10.4 gravel
    expect(f.windFromCompass).toBe('SW'); // 225°
    expect(f.rainChancePct).toBe(20);
    expect(f.daylightMarginMin).toBe(110);
    expect(f.maxGustMs).toBe(14.2);
    expect(f.ice).toBeNull();
  });

  it('exposes ONLY the whitelisted fields (grounding regression guard)', () => {
    expect(Object.keys(buildBriefingFacts(scored, cond, rideStart)).sort()).toEqual(FACT_KEYS);
  });

  it('clamps an out-of-range rain percent', () => {
    expect(buildBriefingFacts(scored, { ...cond, precipProb: 130 }, rideStart).rainChancePct).toBe(
      100,
    );
  });

  it('leaves the daylight margin null when sunset is unknown', () => {
    const f = buildBriefingFacts(scored, { ...cond, sunset: null }, rideStart);
    expect(f.daylightMarginMin).toBeNull();
  });

  it('carries winter ice facts through when supplied', () => {
    const f = buildBriefingFacts(scored, cond, rideStart, { iceRisk: true, minTempC: -3 });
    expect(f.ice).toEqual({ iceRisk: true, minTempC: -3 });
  });
});

describe('briefingRequest', () => {
  it('grounds the prompt in the facts and demands JSON — with no Strava anywhere', () => {
    const req = briefingRequest(buildBriefingFacts(scored, cond, rideStart));
    expect(req.system.toLowerCase()).toContain('json');
    expect(req.prompt).toContain('42.2'); // the distance number is in the prompt
    // Guardrail: nothing Strava-derived may ever reach the AI (CLAUDE.md domain warning).
    expect(`${req.system} ${req.prompt}`.toLowerCase()).not.toContain('strava');
  });
});

describe('parseBriefing', () => {
  const valid = {
    summary: 'Cool, breezy SW day — layer up and start into the wind.',
    clothing: ['Light jacket', 'Full gloves'],
    fuel: 'One bottle and a bar should cover it.',
    safety: ['Watch the exposed coast stretch for gusts.'],
  };

  it('accepts a well-formed briefing', () => {
    expect(parseBriefing(valid)).toEqual(valid);
  });

  it('treats safety as optional (empty list when absent)', () => {
    const noSafety = { summary: valid.summary, clothing: valid.clothing, fuel: valid.fuel };
    expect(parseBriefing(noSafety)?.safety).toEqual([]);
  });

  it.each([
    ['not an object', 42],
    ['missing summary', { ...valid, summary: undefined }],
    ['missing fuel', { ...valid, fuel: '' }],
    ['clothing not an array', { ...valid, clothing: 'a scarf' }],
    ['clothing empty', { ...valid, clothing: [] }],
  ])('rejects %s', (_label, bad) => {
    expect(parseBriefing(bad)).toBeNull();
  });

  it('caps runaway item counts and string lengths', () => {
    const out = parseBriefing({
      ...valid,
      clothing: Array.from({ length: 20 }, (_, i) => `item ${i}`),
      fuel: 'x'.repeat(1000),
    });
    expect(out!.clothing.length).toBeLessThanOrEqual(6);
    expect(out!.fuel.length).toBeLessThanOrEqual(240);
  });
});
