import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { idbStateStorage } from './persist';

describe('idbStateStorage', () => {
  it('round-trips values through IndexedDB and removes them', async () => {
    await idbStateStorage.setItem('windride-plan', '{"state":{"inputs":{"distanceKm":80}}}');
    expect(await idbStateStorage.getItem('windride-plan')).toBe(
      '{"state":{"inputs":{"distanceKm":80}}}',
    );
    await idbStateStorage.removeItem('windride-plan');
    expect(await idbStateStorage.getItem('windride-plan')).toBeNull();
  });
});
