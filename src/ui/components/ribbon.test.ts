import { describe, expect, it } from 'vitest';
import { layoutRibbon, type RibbonSegment } from './ribbon';

describe('layoutRibbon', () => {
  it('normalises fractions that already sum to 1', () => {
    const segs: RibbonSegment[] = [
      { fraction: 0.5, kind: 'tail' },
      { fraction: 0.5, kind: 'head' },
    ];
    const laid = layoutRibbon(segs, 100);
    expect(laid.map((s) => s.width)).toEqual([50, 50]);
    expect(laid.map((s) => s.x)).toEqual([0, 50]);
    expect(laid[0].fraction).toBeCloseTo(0.5);
  });

  it('normalises fractions that do NOT sum to 1', () => {
    const segs: RibbonSegment[] = [
      { fraction: 2, kind: 'tail' },
      { fraction: 1, kind: 'head' },
    ];
    const laid = layoutRibbon(segs, 90);
    expect(laid.map((s) => s.width)).toEqual([60, 30]);
    expect(laid[0].fraction).toBeCloseTo(2 / 3);
  });

  it('lays out widths that sum EXACTLY to the total width (cumulative rounding)', () => {
    const segs: RibbonSegment[] = [
      { fraction: 1, kind: 'tail' },
      { fraction: 1, kind: 'cross' },
      { fraction: 1, kind: 'head' },
    ];
    const total = 100;
    const laid = layoutRibbon(segs, total);
    expect(laid.reduce((acc, s) => acc + s.width, 0)).toBe(total);
    // Segments are contiguous: each x equals the previous x + width.
    expect(laid[1].x).toBe(laid[0].width);
    expect(laid[2].x).toBe(laid[0].width + laid[1].width);
  });

  it('drops non-positive fractions instead of emitting zero-width segments', () => {
    const laid = layoutRibbon(
      [
        { fraction: -1, kind: 'tail' },
        { fraction: 0, kind: 'cross' },
        { fraction: 1, kind: 'head' },
      ],
      100,
    );
    expect(laid).toHaveLength(1);
    expect(laid[0].kind).toBe('head');
    expect(laid[0].width).toBe(100);
  });

  it('returns [] for empty, all-zero, or zero-width input', () => {
    expect(layoutRibbon([], 100)).toEqual([]);
    expect(layoutRibbon([{ fraction: 0, kind: 'tail' }], 100)).toEqual([]);
    expect(layoutRibbon([{ fraction: 1, kind: 'tail' }], 0)).toEqual([]);
  });
});
