import { beforeEach, describe, expect, it } from 'vitest';
import type { AiClient } from '../adapters/ai';
import type { RideSummary } from '../domain';
import { useRecapStore } from './recapStore';

const summary: RideSummary = { distanceM: 40000, elapsedS: 7200, movingS: 6600, avgSpeedMs: 6 };
const VALID = { summary: 'Great ride!', highlights: ['Strong pace.'] };

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

beforeEach(() => useRecapStore.getState().reset());

describe('recapStore.generate', () => {
  it('produces a validated recap on success', async () => {
    await useRecapStore.getState().generate('ride-1', summary, clientReturning(VALID));
    const s = useRecapStore.getState();
    expect(s.status).toBe('ready');
    expect(s.recap?.summary).toBe('Great ride!');
    expect(s.rideId).toBe('ride-1');
  });

  it('errors with no recap when the response is malformed', async () => {
    await useRecapStore.getState().generate('ride-1', summary, clientReturning({ junk: true }));
    expect(useRecapStore.getState().status).toBe('error');
    expect(useRecapStore.getState().recap).toBeNull();
  });

  it('errors cleanly when AI is not set up', async () => {
    await useRecapStore.getState().generate('ride-1', summary);
    expect(useRecapStore.getState().status).toBe('error');
  });

  it('a slow older request never clobbers a newer one (request-token guard)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slowFail: AiClient = {
      provider: 'anthropic',
      async complete() {
        await gate;
        throw new Error('timeout'); // older request fails LATE
      },
    };
    const p1 = useRecapStore.getState().generate('ride-1', summary, slowFail);
    // A newer request for the same ride lands first and succeeds.
    await useRecapStore.getState().generate('ride-1', summary, clientReturning(VALID));
    expect(useRecapStore.getState().status).toBe('ready');
    release();
    await p1; // the older failure resolves last — it must NOT overwrite the success
    expect(useRecapStore.getState().status).toBe('ready');
    expect(useRecapStore.getState().recap?.summary).toBe('Great ride!');
  });
});
