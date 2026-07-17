/**
 * nav/windHud.ts — wind HUD data from scored segments (WR-016, NAVIGATION_SPEC §5). Pure.
 *
 * WindRide's signature promise: "Tailwind in 2.3 km". Given the chosen route's scored segments and
 * how far the rider has progressed, find the next change in wind relationship ahead.
 */
import type { SegmentAnalysis } from '../engine/scoring';
import { classifyWindKind, type WindKind } from '../engine/wind';

export type { WindKind };

/** A route segment reduced to what the HUD needs: its length and wind relationship. */
export interface WindHudSegment {
  lengthM: number;
  kind: WindKind;
}

/** The next change in wind relationship ahead of the rider. */
export interface WindTransition {
  /** The wind kind the rider is about to enter. */
  kind: WindKind;
  /** Distance ahead to that transition (m). */
  inM: number;
}

/** Reduce scored segments to HUD segments (wind kind per segment). */
export function toWindHudSegments(segments: SegmentAnalysis[]): WindHudSegment[] {
  return segments.map((sa) => ({
    lengthM: sa.seg.lengthM,
    kind: classifyWindKind(sa.wind.deltaDeg),
  }));
}

/**
 * The next wind-kind change ahead of `progressM`, or null if the wind relationship doesn't change
 * before the finish. The "current" kind is that of the segment the rider is in; the transition is
 * the first later segment whose kind differs.
 */
export function nextWindTransition(
  segments: WindHudSegment[],
  progressM: number,
): WindTransition | null {
  if (segments.length === 0) return null;

  // Locate the current segment and its start distance.
  let start = 0;
  let currentIdx = 0;
  for (let i = 0; i < segments.length; i++) {
    const end = start + segments[i].lengthM;
    if (progressM < end || i === segments.length - 1) {
      currentIdx = i;
      break;
    }
    start = end;
  }
  const currentKind = segments[currentIdx].kind;

  // Walk forward accumulating distance to the first differing kind.
  let atM = start + segments[currentIdx].lengthM; // start distance of the next segment
  for (let i = currentIdx + 1; i < segments.length; i++) {
    if (segments[i].kind !== currentKind) {
      return { kind: segments[i].kind, inM: Math.max(0, atM - progressM) };
    }
    atM += segments[i].lengthM;
  }
  return null;
}
