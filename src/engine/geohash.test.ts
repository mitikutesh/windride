import { describe, expect, it } from 'vitest';
import { haversineM } from './geometry';
import { decodeGeohashCenter, encodeGeohash } from './geohash';

describe('geohash', () => {
  it('is deterministic and 7 chars at default precision', () => {
    const h = encodeGeohash(60.17, 24.94);
    expect(h).toHaveLength(7);
    expect(encodeGeohash(60.17, 24.94)).toBe(h);
  });

  it('round-trips: decoded centre is within the ~150 m cell of the input', () => {
    const p = { lat: 60.1699, lon: 24.9384 };
    const c = decodeGeohashCenter(encodeGeohash(p.lat, p.lon));
    expect(haversineM(p, c)).toBeLessThan(120);
  });

  it('nearby points share a cell; far-apart points do not', () => {
    const base = encodeGeohash(60.17, 24.94);
    expect(encodeGeohash(60.1702, 24.9403)).toBe(base); // ~25 m away → same cell
    expect(encodeGeohash(60.18, 24.96)).not.toBe(base); // ~1.5 km away → different cell
  });

  it('rejects an invalid geohash char on decode', () => {
    expect(() => decodeGeohashCenter('abc')).toThrow(/invalid geohash/); // 'a' is not in base32
  });
});
