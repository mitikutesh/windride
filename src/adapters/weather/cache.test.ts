import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { WindGrid } from '../../domain';
import { createWeatherCache } from './cache';

const grid: WindGrid = [
  [
    {
      windMs: 8,
      windFromDeg: 225,
      gustMs: 12,
      precipProb: 10,
      tempC: 17,
      time: '2026-07-10T17:00',
    },
  ],
];

describe('createWeatherCache', () => {
  it('returns a cached value before its TTL and drops it after', async () => {
    let t = 1000;
    const cache = createWeatherCache(() => t);
    await cache.set('k', grid, 2000); // expires at t=2000
    expect(await cache.get('k')).toEqual(grid);
    t = 2500;
    expect(await cache.get('k')).toBeUndefined();
  });

  it('persists across cache instances via IndexedDB', async () => {
    const t = 1000;
    const writer = createWeatherCache(() => t);
    await writer.set('persist-key', grid, 9999);
    // A fresh instance has an empty in-memory map; the hit must come from idb.
    const reader = createWeatherCache(() => t);
    expect(await reader.get('persist-key')).toEqual(grid);
  });
});
