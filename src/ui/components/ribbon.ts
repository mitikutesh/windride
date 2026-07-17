/**
 * WindRibbon layout math (pure, WR-002).
 *
 * A ribbon is a horizontal story bar of wind relationships. Callers pass raw fractions
 * (which need not sum to 1); we normalise over the positive fractions and lay out pixel
 * widths using cumulative rounding so the segment widths sum EXACTLY to the total width
 * (no sub-pixel gaps or overshoot). Colour always means wind relationship (DESIGN §1).
 */
export type WindKind = 'tail' | 'cross' | 'head' | 'shelter';

export interface RibbonSegment {
  fraction: number;
  kind: WindKind;
}

export interface LaidOutSegment {
  kind: WindKind;
  /** Normalised share of the whole (0..1). */
  fraction: number;
  /** Pixel x-offset of the segment's left edge. */
  x: number;
  /** Pixel width of the segment. */
  width: number;
}

export function layoutRibbon(segments: RibbonSegment[], totalWidth: number): LaidOutSegment[] {
  // Clamp negatives to zero; a segment can't have negative length.
  const positive = segments.map((s) => ({ kind: s.kind, fraction: Math.max(0, s.fraction) }));
  const sum = positive.reduce((acc, s) => acc + s.fraction, 0);
  if (sum <= 0 || totalWidth <= 0) return [];

  const out: LaidOutSegment[] = [];
  let cumulativeFraction = 0;
  let prevX = 0;
  for (const s of positive) {
    const norm = s.fraction / sum;
    cumulativeFraction += norm;
    // Round the running boundary, not each width, so rounding error never accumulates.
    const nextX = Math.round(cumulativeFraction * totalWidth);
    out.push({ kind: s.kind, fraction: norm, x: prevX, width: nextX - prevX });
    prevX = nextX;
  }
  return out;
}
