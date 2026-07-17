import { describe, expect, it } from 'vitest';
import type { SegmentAnalysis } from '../engine/scoring';
import { nextWindTransition, toWindHudSegments, type WindHudSegment } from './windHud';

const seg = (lengthM: number, kind: WindHudSegment['kind']): WindHudSegment => ({ lengthM, kind });

describe('toWindHudSegments', () => {
  it('classifies each scored segment by its wind delta angle', () => {
    const analyses = [
      { seg: { lengthM: 100 }, wind: { deltaDeg: 20 } },
      { seg: { lengthM: 100 }, wind: { deltaDeg: 90 } },
      { seg: { lengthM: 100 }, wind: { deltaDeg: 150 } },
    ] as unknown as SegmentAnalysis[];
    expect(toWindHudSegments(analyses).map((s) => s.kind)).toEqual(['tail', 'cross', 'head']);
  });
});

describe('nextWindTransition', () => {
  const segs = [
    seg(100, 'head'),
    seg(100, 'head'),
    seg(100, 'tail'),
    seg(100, 'tail'),
    seg(100, 'cross'),
  ];

  it('finds the next differing kind ahead and its distance', () => {
    expect(nextWindTransition(segs, 50)).toEqual({ kind: 'tail', inM: 150 }); // head -> tail at 200 m
  });

  it('reports the next change relative to the current segment', () => {
    expect(nextWindTransition(segs, 250)).toEqual({ kind: 'cross', inM: 150 }); // tail -> cross at 400 m
  });

  it('handles a progress exactly on a segment boundary', () => {
    expect(nextWindTransition(segs, 200)).toEqual({ kind: 'cross', inM: 200 });
  });

  it('returns null when the wind kind does not change before the finish', () => {
    expect(nextWindTransition([seg(100, 'tail'), seg(100, 'tail')], 50)).toBeNull();
  });

  it('returns null once in the last segment', () => {
    expect(nextWindTransition(segs, 450)).toBeNull();
  });

  it('returns null for an empty route', () => {
    expect(nextWindTransition([], 0)).toBeNull();
  });
});
