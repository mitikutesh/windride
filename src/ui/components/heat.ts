// ui/components/heat.ts — score-bucket math for the HeatStrip (WR-020). Pure.

export const HEAT_BUCKETS = 5;

/** Map a score to a bucket 0..HEAT_BUCKETS-1 (0 = worst) across [min, max]. */
export function heatBucket(total: number, min: number, max: number): number {
  if (max - min < 1e-9) return Math.floor(HEAT_BUCKETS / 2);
  const t = (total - min) / (max - min);
  return Math.max(0, Math.min(HEAT_BUCKETS - 1, Math.floor(t * HEAT_BUCKETS)));
}
