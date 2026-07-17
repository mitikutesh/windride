import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createIdbCache } from './idbCache';

type Blob = { n: number; nested: { list: number[] } };
const value: Blob = { n: 1, nested: { list: [1, 2, 3] } };

describe('createIdbCache', () => {
  it('honours the TTL (fresh before, gone after)', async () => {
    let t = 1000;
    const cache = createIdbCache<Blob>('ttl-db', 's', () => t);
    await cache.set('k', value, 2000);
    expect(await cache.get('k')).toEqual(value);
    t = 2500;
    expect(await cache.get('k')).toBeUndefined();
  });

  it('persists across instances via IndexedDB', async () => {
    const t = 1000;
    const writer = createIdbCache<Blob>('persist-db', 's', () => t);
    await writer.set('k', value, 9999);
    const reader = createIdbCache<Blob>('persist-db', 's', () => t);
    expect(await reader.get('k')).toEqual(value);
  });

  it('returns a defensive copy so callers cannot corrupt the cache', async () => {
    const cache = createIdbCache<Blob>('clone-db', 's', () => 1000);
    await cache.set('k', value, 9999);
    const got = (await cache.get('k'))!;
    got.nested.list.push(999); // mutate the returned object
    const again = (await cache.get('k'))!;
    expect(again.nested.list).toEqual([1, 2, 3]); // cache is untouched
  });

  it('does not return an expired persisted row', async () => {
    let t = 1000;
    const writer = createIdbCache<Blob>('expire-db', 's', () => t);
    await writer.set('k', value, 1500);
    t = 2000;
    const reader = createIdbCache<Blob>('expire-db', 's', () => t);
    expect(await reader.get('k')).toBeUndefined();
  });
});
