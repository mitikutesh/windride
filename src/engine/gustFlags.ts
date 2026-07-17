/**
 * engine/gustFlags.ts — exposed high-crosswind gust detection (WR-021, SCORING_SPEC §4). Pure.
 *
 * Single source of truth for "dangerous crosswind": the CrosswindSafety sub-score, the results
 * warning chips + map markers, and the ride-time warning all consume detectGustStretches. A segment
 * is flagged when the effective gust is strong, the wind is mostly across the direction of travel,
 * and the segment is exposed. Contiguous flagged segments (bridging short calm gaps) merge into
 * stretches; only stretches ≥ MIN_STRETCH_M are reported.
 */
import type { LatLon } from '../domain';
import type { SegmentAnalysis } from './scoring';

export const GUST_FLAG_THRESHOLD_MS = 13; // default; settings range 10–18
export const CROSS_FRACTION = 0.6; // v_cross ≥ 0.6 · W_eff ⇒ "mostly crosswind"
export const MIN_STRETCH_M = 300;
export const GAP_BRIDGE_M = 150; // a brief calm shorter than this doesn't split a stretch

export interface GustStretch {
  startM: number;
  endM: number;
  lengthM: number;
  /** Inclusive segment index range covered by the stretch. */
  startSegIdx: number;
  endSegIdx: number;
  midpoint: LatLon;
  maxGustMs: number;
}

/** Is this segment an exposed, mostly-crosswind, strong-gust segment? */
export function isGustFlagged(sa: SegmentAnalysis, thresholdMs = GUST_FLAG_THRESHOLD_MS): boolean {
  return (
    sa.seg.exposure >= 1.0 &&
    sa.wind.gustEffMs >= thresholdMs &&
    sa.wind.vCrossMs >= CROSS_FRACTION * sa.wind.effectiveMs
  );
}

export interface GustFlagOptions {
  thresholdMs?: number;
  minStretchM?: number;
  gapBridgeM?: number;
}

/** Merge flagged segments into stretches ≥ minStretchM, bridging calm gaps < gapBridgeM. */
export function detectGustStretches(
  segments: SegmentAnalysis[],
  opts: GustFlagOptions = {},
): GustStretch[] {
  const thresholdMs = opts.thresholdMs ?? GUST_FLAG_THRESHOLD_MS;
  const minStretchM = opts.minStretchM ?? MIN_STRETCH_M;
  const gapBridgeM = opts.gapBridgeM ?? GAP_BRIDGE_M;

  // Cumulative start distance of each segment.
  const start: number[] = [];
  let acc = 0;
  for (const sa of segments) {
    start.push(acc);
    acc += sa.seg.lengthM;
  }

  const stretches: GustStretch[] = [];
  let run: { firstIdx: number; lastIdx: number } | null = null;

  const close = () => {
    if (!run) return;
    const startM = start[run.firstIdx];
    const endM = start[run.lastIdx] + segments[run.lastIdx].seg.lengthM;
    if (endM - startM >= minStretchM) {
      let maxGustMs = 0;
      for (let i = run.firstIdx; i <= run.lastIdx; i++) {
        if (isGustFlagged(segments[i], thresholdMs)) {
          maxGustMs = Math.max(maxGustMs, segments[i].wind.gustEffMs);
        }
      }
      stretches.push({
        startM,
        endM,
        lengthM: endM - startM,
        startSegIdx: run.firstIdx,
        endSegIdx: run.lastIdx,
        midpoint: pointAtM(segments, start, (startM + endM) / 2),
        maxGustMs,
      });
    }
    run = null;
  };

  for (let i = 0; i < segments.length; i++) {
    if (!isGustFlagged(segments[i], thresholdMs)) continue;
    if (run === null) {
      run = { firstIdx: i, lastIdx: i };
    } else {
      const gap = start[i] - (start[run.lastIdx] + segments[run.lastIdx].seg.lengthM);
      if (gap <= gapBridgeM)
        run.lastIdx = i; // bridge the short calm gap
      else {
        close();
        run = { firstIdx: i, lastIdx: i };
      }
    }
  }
  close();
  return stretches;
}

/** The set of segment indices covered by any stretch — the sub-score's penalty domain. */
export function flaggedSegmentIndices(stretches: GustStretch[]): Set<number> {
  const set = new Set<number>();
  for (const s of stretches) for (let i = s.startSegIdx; i <= s.endSegIdx; i++) set.add(i);
  return set;
}

/** Interpolated LatLon at distance `m` along the segments (by endpoints). */
function pointAtM(segments: SegmentAnalysis[], start: number[], m: number): LatLon {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (m >= start[i]) {
      const seg = segments[i].seg;
      const t = seg.lengthM > 0 ? Math.min(1, (m - start[i]) / seg.lengthM) : 0;
      return {
        lat: seg.a.lat + (seg.b.lat - seg.a.lat) * t,
        lon: seg.a.lon + (seg.b.lon - seg.a.lon) * t,
      };
    }
  }
  return segments[0]?.seg.a ?? { lat: 0, lon: 0 };
}
