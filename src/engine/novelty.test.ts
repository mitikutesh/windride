import { describe, expect, it } from 'vitest';
import type { LatLon } from '../domain';
import { encodeGeohash } from './geohash';
import { noveltyShare, trackEdges, uniqueKm, GEOHASH7_CELL_KM } from './novelty';
import type { CandidateAnalysis, SegmentAnalysis } from './scoring';

/** Build a candidate analysis whose segments run through the given midpoints. */
function analysisThrough(mids: LatLon[], lengthM = 1000): CandidateAnalysis {
  const segments = mids.map(
    (m) => ({ seg: { a: m, b: m, lengthM } }) as unknown as SegmentAnalysis,
  );
  return { segments } as unknown as CandidateAnalysis;
}

const A: LatLon = { lat: 60.17, lon: 24.94 };
const B: LatLon = { lat: 60.25, lon: 24.6 };
const C: LatLon = { lat: 60.4, lon: 25.1 };

describe('noveltyShare', () => {
  it('is 1.0 when nothing has been ridden (all roads new)', () => {
    expect(noveltyShare(analysisThrough([A, B, C]), new Set())).toBe(1);
  });

  it('is 0 when every segment falls in a ridden cell', () => {
    const ridden = new Set([A, B, C].map((p) => encodeGeohash(p.lat, p.lon)));
    expect(noveltyShare(analysisThrough([A, B, C]), ridden)).toBe(0);
  });

  it('is the unridden LENGTH share (time/distance-honest), not a segment count', () => {
    // One 3 km ridden segment + one 1 km new segment ⇒ 1/4 new by length.
    const analysis: CandidateAnalysis = {
      segments: [
        { seg: { a: A, b: A, lengthM: 3000 } },
        { seg: { a: B, b: B, lengthM: 1000 } },
      ] as unknown as SegmentAnalysis[],
    } as unknown as CandidateAnalysis;
    const ridden = new Set([encodeGeohash(A.lat, A.lon)]);
    expect(noveltyShare(analysis, ridden)).toBeCloseTo(0.25, 6);
  });
});

describe('record-side ↔ score-side geohash contract', () => {
  it('a route you literally rode reads as (nearly) fully ridden', () => {
    // A straight 3 km N-bound route (3 × 1 km segments), scored by segment-midpoint cells...
    const lat0 = 60.1;
    const lon0 = 24.9;
    const per1km = 0.009; // ≈ 1 km of latitude
    const analysis: CandidateAnalysis = {
      segments: [0, 1, 2].map(
        (i) =>
          ({
            seg: {
              a: { lat: lat0 + i * per1km, lon: lon0 },
              b: { lat: lat0 + (i + 1) * per1km, lon: lon0 },
              lengthM: 1000,
            },
          }) as unknown as SegmentAnalysis,
      ),
    } as unknown as CandidateAnalysis;
    // ...and ridden with dense (~50 m) fixes tracing the same line — a DIFFERENT midpoint convention
    // (consecutive fixes) than the candidate's segment midpoints, yet it must read as ridden.
    const points: LatLon[] = [];
    for (let m = 0; m <= 3000; m += 50) points.push({ lat: lat0 + (m / 1000) * per1km, lon: lon0 });
    const ridden = trackEdges(points);
    expect(noveltyShare(analysis, ridden)).toBeLessThan(0.1);
  });
});

describe('trackEdges', () => {
  it('merging a re-saved ride adds nothing (idempotent)', () => {
    const track: LatLon[] = [A, { lat: 60.171, lon: 24.941 }, B];
    const first = trackEdges(track);
    const merged = new Set(first);
    for (const e of trackEdges(track)) merged.add(e); // re-save
    expect(merged.size).toBe(first.size);
  });

  it('encodes a single-point ride at that point', () => {
    expect(trackEdges([A])).toEqual(new Set([encodeGeohash(A.lat, A.lon)]));
  });
});

describe('uniqueKm', () => {
  it('estimates explored km from the edge count', () => {
    expect(uniqueKm(new Set(['a', 'b', 'c']))).toBeCloseTo(3 * GEOHASH7_CELL_KM, 6);
  });
});
