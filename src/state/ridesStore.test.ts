import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendRidePoints,
  createRide,
  deleteRide,
  listRides,
  setStravaCreds,
  type RecordedRide,
} from '../data/db';
import { useRidesStore } from './ridesStore';

async function seedFinishedRide(id: string): Promise<void> {
  const ride: RecordedRide = { id, name: `Ride ${id}`, startedAt: 1e12, status: 'finished' };
  await createRide(ride);
  await appendRidePoints([
    { rideId: id, seq: 0, lat: 60, lon: 24, time: '2026-07-10T09:00:00Z' },
    { rideId: id, seq: 1, lat: 60.01, lon: 24, time: '2026-07-10T09:00:10Z' },
  ]);
}

describe('ridesStore.sendToStrava', () => {
  beforeEach(async () => {
    for (const r of await listRides()) await deleteRide(r.id);
    useRidesStore.setState({
      rides: [],
      strava: {},
      stravaError: {},
      stravaErrorCode: {},
      error: null,
    });
    // Clear any creds from a prior test.
    const db = await (await import('../data/db')).openWindrideDb();
    await db.delete('strava', 'creds');
  });

  it('flags no-creds when Strava is not set up', async () => {
    await seedFinishedRide('a');
    await useRidesStore.getState().refresh();
    await useRidesStore.getState().sendToStrava('a');
    expect(useRidesStore.getState().strava['a']).toBe('no-creds');
  });

  it('uploads via the injected sender and records the activity id', async () => {
    await setStravaCreds({ clientId: '1', clientSecret: 's', refreshToken: 'r' });
    await seedFinishedRide('b');
    await useRidesStore.getState().refresh();
    const send = vi.fn().mockResolvedValue(555);
    await useRidesStore.getState().sendToStrava('b', send);
    expect(send).toHaveBeenCalledOnce();
    expect(useRidesStore.getState().strava['b']).toBe('done');
    const saved = (await listRides()).find((r) => r.id === 'b')!;
    expect(saved.stravaActivityId).toBe(555);
  });

  it('is idempotent: a ride already on Strava is not re-sent', async () => {
    await setStravaCreds({ clientId: '1', clientSecret: 's', refreshToken: 'r' });
    await seedFinishedRide('c');
    await useRidesStore.getState().refresh();
    const first = vi.fn().mockResolvedValue(777);
    await useRidesStore.getState().sendToStrava('c', first);
    const second = vi.fn().mockResolvedValue(888);
    await useRidesStore.getState().refresh(); // now the ride carries stravaActivityId
    await useRidesStore.getState().sendToStrava('c', second);
    expect(second).not.toHaveBeenCalled();
  });

  it('surfaces the specific failure reason, not just a generic error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await setStravaCreds({ clientId: '1', clientSecret: 's', refreshToken: 'r' });
    await seedFinishedRide('e');
    await useRidesStore.getState().refresh();
    const { ProviderError } = await import('../adapters/errors');
    const send = vi
      .fn()
      .mockRejectedValue(new ProviderError('badResponse', 'Strava upload auth failed', 'auth'));
    await useRidesStore.getState().sendToStrava('e', send);
    expect(useRidesStore.getState().strava['e']).toBe('error');
    expect(useRidesStore.getState().stravaError['e']).toBe(
      'Strava upload auth failed. Tap to retry',
    );
    expect(useRidesStore.getState().stravaErrorCode['e']).toBe('auth'); // Kit → Strava can fix it
  });

  it('flags duplicate as its own state', async () => {
    await setStravaCreds({ clientId: '1', clientSecret: 's', refreshToken: 'r' });
    await seedFinishedRide('d');
    await useRidesStore.getState().refresh();
    const { ProviderError } = await import('../adapters/errors');
    const send = vi.fn().mockRejectedValue(new ProviderError('badResponse', 'dup', 'duplicate'));
    await useRidesStore.getState().sendToStrava('d', send);
    expect(useRidesStore.getState().strava['d']).toBe('duplicate');
  });
});
