import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AiClient } from '../adapters/ai';
import { usePlanStore } from './planStore';
import { useNlPlanStore } from './nlPlanStore';

/** A fake AI client that validates the given raw payload exactly as the real adapter would. */
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

beforeEach(() => {
  useNlPlanStore.getState().reset();
  usePlanStore.getState().setInput({ distanceKm: 50, surface: 'road', routeType: 'loop' });
});

describe('nlPlanStore.interpret', () => {
  it('applies a validated + clamped patch to the plan inputs', async () => {
    await useNlPlanStore
      .getState()
      .interpret('80 km gravel', clientReturning({ distanceKm: 82, surface: 'gravel' }));
    const s = useNlPlanStore.getState();
    expect(s.status).toBe('ready');
    expect(usePlanStore.getState().inputs.distanceKm).toBe(80); // 82 snapped
    expect(usePlanStore.getState().inputs.surface).toBe('gravel');
    expect(s.changed).toEqual(expect.arrayContaining(['Distance', 'Surface']));
  });

  it('phrases an auth failure toward Kit rather than rephrasing', async () => {
    const { ProviderError } = await import('../adapters/errors');
    const client: AiClient = {
      provider: 'anthropic',
      async complete() {
        throw new ProviderError('badResponse', 'rejected', 'auth');
      },
    };
    await useNlPlanStore.getState().interpret('a ride', client);
    expect(useNlPlanStore.getState().status).toBe('error');
    expect(useNlPlanStore.getState().error).toMatch(/Kit/);
  });

  it('errors and changes nothing when the response is unusable', async () => {
    await useNlPlanStore
      .getState()
      .interpret('gibberish', clientReturning({ routeType: 'nonsense' }));
    expect(useNlPlanStore.getState().status).toBe('error');
    expect(usePlanStore.getState().inputs.distanceKm).toBe(50); // untouched
  });

  it('is a no-op on empty text', async () => {
    await useNlPlanStore.getState().interpret('   ', clientReturning({ surface: 'gravel' }));
    expect(useNlPlanStore.getState().status).toBe('idle');
  });

  it('errors when AI is not set up (registry returns no client)', async () => {
    await useNlPlanStore.getState().interpret('a ride');
    expect(useNlPlanStore.getState().status).toBe('error');
  });
});
