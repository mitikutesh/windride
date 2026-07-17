/**
 * ScoreRing arc math (pure, WR-002).
 *
 * Draws a 0–100 score as a stroked SVG circle. We express the fill via stroke-dasharray =
 * full circumference and stroke-dashoffset = the un-filled remainder, so:
 *   score 0   -> dashOffset = circumference (empty ring)
 *   score 50  -> dashOffset = circumference / 2 (half)
 *   score 100 -> dashOffset = 0 (full ring)
 */
export interface RingGeometry {
  /** Circle centre (size / 2). */
  center: number;
  radius: number;
  circumference: number;
  dashArray: number;
  dashOffset: number;
  /** Score clamped to 0..100. */
  score: number;
}

export function ringGeometry(score: number, size: number, stroke: number): RingGeometry {
  const clamped = Math.max(0, Math.min(100, score));
  const center = size / 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (clamped / 100) * circumference;
  return {
    center,
    radius,
    circumference,
    dashArray: circumference,
    dashOffset: circumference - filled,
    score: clamped,
  };
}
