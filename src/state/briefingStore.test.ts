import { beforeEach, describe, expect, it } from 'vitest';
import type { AiClient } from '../adapters/ai';
import type { BriefingConditions } from '../engine/briefing';
import type { ScoredCandidate } from '../engine/scoring';
import { useBriefingStore } from './briefingStore';

const scored = (id: string) =>
  ({
    candidate: { id },
    evidence: {
      distanceKm: 40,
      ascentM: 300,
      gravelKm: 5,
      headwindKm: 8,
      tailwindKm: 8,
      gustyKm: 1,
      maxGustMs: 10,
    },
    analysis: { totalTimeS: 5400 },
  }) as unknown as ScoredCandidate;

const cond: BriefingConditions = {
  tempC: 12,
  feelsC: 10,
  windMs: 6,
  windFromDeg: 200,
  gustMs: 9,
  precipProb: 10,
  sunset: '2026-07-20T22:00:00Z',
};

const VALID = { summary: 'Nice day', clothing: ['light jacket'], fuel: 'a bottle', safety: [] };

/** A fake AI client that validates the given raw payload exactly as the real adapter would. */
function clientReturning(raw: unknown): AiClient {
  return {
    provider: 'anthropic',
    async complete(_req, parse) {
      const v = parse(raw);
      if (v === null) throw new Error('malformed'); // mirrors the adapter: parse-null ⇒ throw
      return v;
    },
  };
}

beforeEach(() => useBriefingStore.getState().reset());

describe('briefingStore.generate', () => {
  it('produces a validated briefing on success', async () => {
    await useBriefingStore
      .getState()
      .generate(scored('a'), cond, null, { client: clientReturning(VALID) });
    const s = useBriefingStore.getState();
    expect(s.status).toBe('ready');
    expect(s.briefing?.summary).toBe('Nice day');
    expect(s.routeId).toBe('a');
  });

  it('errors with no briefing when the response is malformed', async () => {
    await useBriefingStore
      .getState()
      .generate(scored('a'), cond, null, { client: clientReturning({ junk: true }) });
    const s = useBriefingStore.getState();
    expect(s.status).toBe('error');
    expect(s.briefing).toBeNull();
  });

  it('drops a stale result when the user switched routes mid-flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow: AiClient = {
      provider: 'anthropic',
      async complete(_req, parse) {
        await gate;
        const v = parse(VALID);
        if (v === null) throw new Error('malformed');
        return v;
      },
    };
    const pending = useBriefingStore.getState().generate(scored('a'), cond, null, { client: slow });
    // The user switches to route B; a fast run for B lands first.
    await useBriefingStore
      .getState()
      .generate(scored('b'), cond, null, { client: clientReturning(VALID) });
    expect(useBriefingStore.getState().routeId).toBe('b');
    release();
    await pending; // A's slow response resolves last — it must NOT overwrite B's state
    expect(useBriefingStore.getState().routeId).toBe('b');
    expect(useBriefingStore.getState().status).toBe('ready');
  });

  it('errors cleanly when AI is not set up (registry returns no client)', async () => {
    await useBriefingStore.getState().generate(scored('a'), cond, null, {});
    expect(useBriefingStore.getState().status).toBe('error');
  });
});
