/**
 * engine/startTime.ts — pick the joint best (route, departure hour) and phrase it (WR-020). Pure.
 * Operates on a StartTimeMatrix (jointly-normalised scores) so cells are comparable across hours.
 */
import type { StartTimeMatrix } from './scoring';

export interface BestStart {
  candidateId: string;
  hourIndex: number;
  total: number;
}

/** Highest-scoring cell within `allowedHours` (all hours if omitted). Ties: earlier hour, then id. */
export function bestStart(matrix: StartTimeMatrix, allowedHours?: number[]): BestStart | null {
  const allowed = allowedHours ? new Set(allowedHours) : null;
  let best: BestStart | null = null;
  for (const row of matrix.rows) {
    for (const cell of row.cells) {
      if (cell.total === null) continue;
      if (allowed && !allowed.has(cell.hourIndex)) continue;
      const cand: BestStart = {
        candidateId: row.candidate.id,
        hourIndex: cell.hourIndex,
        total: cell.total,
      };
      if (best === null || better(cand, best)) best = cand;
    }
  }
  return best;
}

function better(a: BestStart, b: BestStart): boolean {
  if (a.total !== b.total) return a.total > b.total;
  if (a.hourIndex !== b.hourIndex) return a.hourIndex < b.hourIndex; // prefer sooner
  return a.candidateId.localeCompare(b.candidateId) < 0;
}

/** Max total for a candidate over the allowed hours, or null if every cell is rejected. */
function candidateBest(
  matrix: StartTimeMatrix,
  candidateId: string,
  allowed: Set<number> | null,
): number | null {
  let max: number | null = null;
  const row = matrix.rows.find((r) => r.candidate.id === candidateId);
  for (const cell of row?.cells ?? []) {
    if (cell.total === null) continue;
    if (allowed && !allowed.has(cell.hourIndex)) continue;
    if (max === null || cell.total > max) max = cell.total;
  }
  return max;
}

export interface StartTimeMessageOptions {
  /** Display label per candidate id, e.g. "Route B". */
  label: (candidateId: string) => string;
  /** Clock label per hour index, e.g. "17:00". */
  hourLabel: (hourIndex: number) => string;
  allowedHours?: number[];
}

/**
 * The joint recommendation sentence, e.g. "Route B at 17:00 beats Route A at any time in your
 * window" when a different route+hour wins over the runner-up's best; otherwise a plain best-window
 * line. Returns a "before dark" message when nothing fits.
 */
export function startTimeMessage(matrix: StartTimeMatrix, opts: StartTimeMessageOptions): string {
  const allowed = opts.allowedHours ? new Set(opts.allowedHours) : null;
  const best = bestStart(matrix, opts.allowedHours);
  if (!best) return 'No ride fits before dark in your window.';

  // The strongest OTHER candidate's best cell in the window.
  let other: { id: string; total: number } | null = null;
  for (const row of matrix.rows) {
    if (row.candidate.id === best.candidateId) continue;
    const max = candidateBest(matrix, row.candidate.id, allowed);
    if (max !== null && (other === null || max > other.total)) {
      other = { id: row.candidate.id, total: max };
    }
  }

  const at = `${opts.label(best.candidateId)} at ${opts.hourLabel(best.hourIndex)}`;
  if (other && best.total > other.total + 0.5) {
    return `${at} beats ${opts.label(other.id)} at any time in your window.`;
  }
  return `${at} is your best window.`;
}
