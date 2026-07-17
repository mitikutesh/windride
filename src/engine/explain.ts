/**
 * engine/explain.ts — rule-based route explanations (WR-007, SCORING_SPEC §8). Pure.
 *
 * Emits the headline (distance + wind-aware ETA) plus the top 1–2 contributing facts, each a
 * templated sentence containing at least one real number sourced from segment data — direct
 * headwind vs the candidate median, tailwind-finish km, gust flags, surface/scenery, climb.
 * No adjectives without a number behind them.
 */
import type { ScoredCandidate } from './scoring';

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Seconds -> "h:mm". */
export function formatDuration(totalS: number): string {
  const totalMin = Math.round(totalS / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

export function explainCandidate(sc: ScoredCandidate, set: ScoredCandidate[]): string {
  const e = sc.evidence;
  const headline = `${e.distanceKm.toFixed(1)} km, wind-aware ETA ${formatDuration(e.timeS)}`;

  const facts: Array<{ priority: number; text: string }> = [];

  const medHead = median(set.map((s) => s.evidence.directHeadwindKm));
  const relief = medHead - e.directHeadwindKm;
  if (set.length > 1 && relief > 0.5) {
    facts.push({
      priority: 3 * sc.sub.wind.normalized + relief,
      text: `only ${e.directHeadwindKm.toFixed(1)} km of direct headwind, ${relief.toFixed(1)} km less than the median candidate`,
    });
  } else {
    facts.push({
      priority: 1.5 * sc.sub.wind.normalized,
      text: `${e.directHeadwindKm.toFixed(1)} km of direct headwind`,
    });
  }

  if (e.tailwindFinishKm > 0.3) {
    facts.push({
      priority: 1 + 2 * sc.sub.sequencing.normalized,
      text: `tailwind for ${e.tailwindFinishKm.toFixed(1)} km on the way home`,
    });
  }
  if (e.gustyKm > 0.1) {
    facts.push({
      priority: 2.5,
      text: `${e.gustyKm.toFixed(1)} km exposed to gusts up to ${e.maxGustMs.toFixed(0)} m/s`,
    });
  }
  if (e.gravelKm > 0.3) {
    facts.push({ priority: 0.8, text: `${e.gravelKm.toFixed(1)} km on gravel` });
  }
  if (e.greenerKm > 0.3) {
    facts.push({ priority: 0.7, text: `${e.greenerKm.toFixed(1)} km on paths and cycleways` });
  }
  if (e.ascentM >= 20) {
    facts.push({ priority: 0.6, text: `${Math.round(e.ascentM)} m of climbing` });
  }

  const top = facts.sort((a, b) => b.priority - a.priority).slice(0, 2);
  return [headline, ...top.map((f) => f.text)].map(capitalize).join('. ') + '.';
}
