/**
 * engine/geohash.ts — minimal geohash encode/decode (WR-028). Pure.
 *
 * We tag ridden roads by the geohash-7 of each segment midpoint. Geohash-7 ≈ 153 m × 153 m cells —
 * deliberately coarse: it's privacy-light (never a precise track) and robust to GPS wobble, while
 * still distinguishing "this road" from "the next one over". That coarseness is the trade-off: two
 * genuinely different lanes within ~150 m share a cell and read as "ridden".
 */
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export const GEOHASH_PRECISION = 7;

/** Encode a lat/lon to a geohash string of `precision` base-32 chars. */
export function encodeGeohash(lat: number, lon: number, precision = GEOHASH_PRECISION): string {
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let hash = '';
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        idx = idx * 2 + 1;
        lonMin = mid;
      } else {
        idx *= 2;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        idx = idx * 2 + 1;
        latMin = mid;
      } else {
        idx *= 2;
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    if (++bit === 5) {
      hash += BASE32[idx];
      bit = 0;
      idx = 0;
    }
  }
  return hash;
}

/** Decode a geohash to the centre of its cell — used for round-trip tests and the km estimate. */
export function decodeGeohashCenter(hash: string): { lat: number; lon: number } {
  let evenBit = true;
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  for (const ch of hash) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error(`invalid geohash char: ${ch}`);
    for (let n = 4; n >= 0; n--) {
      const bitN = (idx >> n) & 1;
      if (evenBit) {
        const mid = (lonMin + lonMax) / 2;
        if (bitN === 1) lonMin = mid;
        else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bitN === 1) latMin = mid;
        else latMax = mid;
      }
      evenBit = !evenBit;
    }
  }
  return { lat: (latMin + latMax) / 2, lon: (lonMin + lonMax) / 2 };
}
