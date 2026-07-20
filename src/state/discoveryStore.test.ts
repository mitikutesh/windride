import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AiClient } from '../adapters/ai';
import type { Providers } from '../adapters/registry';
import { MockRouteProvider } from '../adapters/routing/mock';
import { MockWeatherProvider } from '../adapters/weather/mock';
import { useDiscoveryStore } from './discoveryStore';
import type { PlanInputs } from './plan/runPlan';
import { useResultsStore } from './resultsStore';

const inputs: PlanInputs = {
  distanceKm: 40,
  routeType: 'loop',
  surface: 'gravel',
  homeBeforeDark: false,
  avoidBusy: false,
  start: { lat: 60.17, lon: 24.65 },
};

function providers(): Providers {
  return { routing: new MockRouteProvider(), weather: new MockWeatherProvider() };
}

function clientReturning(raw: unknown): AiClient {
  return {
    provider: 'anthropic',
    async complete(_req, parse) {
      const v = parse(raw);
      if (v === null) throw new Error('malformed');
      return v;
    },
  };
}

const IDEAS = {
  ideas: [
    { name: 'NW lakes', note: 'forest and gravel', bearingDeg: 315 },
    { name: 'To the coast', note: 'open sea views', bearingDeg: 135 },
  ],
};

const deps = () => ({
  providers: providers(),
  now: Date.parse('2026-07-20T09:00:00Z'),
  loadGrid: async () => null, // no shelter asset fetch in tests
});

beforeEach(() => {
  useDiscoveryStore.getState().reset();
  useResultsStore.getState().clear();
});

describe('discoveryStore.discover', () => {
  it('builds + wind-scores discovered routes and publishes them with notes', async () => {
    let navigated = false;
    await useDiscoveryStore.getState().discover(inputs, {
      ...deps(),
      client: clientReturning(IDEAS),
      navigate: () => {
        navigated = true;
      },
    });
    const s = useDiscoveryStore.getState();
    expect(s.status).toBe('ready');
    expect(navigated).toBe(true);

    const ranked = useResultsStore.getState().ranked;
    expect(ranked.length).toBeGreaterThan(0);
    // Discovered routes are disc-prefixed (never collide with a normal plan) and carry a note.
    expect(ranked.every((r) => r.candidate.id.startsWith('disc-'))).toBe(true);
    expect(Object.keys(s.notes).length).toBeGreaterThan(0);
    expect(s.notes[ranked[0].candidate.id]).toMatch(/—/); // "<name> — <note>"
  });

  it('errors and publishes nothing when the AI output is malformed', async () => {
    await useDiscoveryStore
      .getState()
      .discover(inputs, { ...deps(), client: clientReturning({ junk: true }) });
    expect(useDiscoveryStore.getState().status).toBe('error');
    expect(useResultsStore.getState().ranked.length).toBe(0);
  });

  it('errors cleanly when AI is not set up', async () => {
    await useDiscoveryStore.getState().discover(inputs, { ...deps() });
    expect(useDiscoveryStore.getState().status).toBe('error');
  });

  it('caps discovery to at most 3 built routes (ORS free-tier budget)', async () => {
    const many = {
      ideas: [0, 45, 90, 135, 180].map((b, i) => ({ name: `n${i}`, note: 'x', bearingDeg: b })),
    };
    await useDiscoveryStore
      .getState()
      .discover(inputs, { ...deps(), client: clientReturning(many) });
    expect(useResultsStore.getState().ranked.length).toBeLessThanOrEqual(3);
  });
});
