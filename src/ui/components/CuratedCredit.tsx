import { useCuratedStore, isCuratedId } from '../../state/curatedStore';
import { useResultsStore } from '../../state/resultsStore';

/**
 * Required source credits for curated routes (WR-052) in the attribution footer (WR-002): ODbL for
 * OSM-derived entries, a Bikeland credit for theirs. Rendered only while curated routes are the
 * results on screen — gated on the `cur-` id prefix, so replanning normally retires the credit
 * automatically instead of leaving a claim about data that is no longer shown.
 */
export function CuratedCredit() {
  const attributions = useCuratedStore((s) => s.attributions);
  const showing = useResultsStore((s) => s.ranked.some((r) => isCuratedId(r.candidate.id)));
  if (!showing || attributions.length === 0) return null;
  return <> · {attributions.join(' · ')}</>;
}
