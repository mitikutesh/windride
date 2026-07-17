import { useEffect } from 'react';
import { useNoveltyStore } from '../../state/noveltyStore';

/**
 * Explored-roads settings (WR-028): total unique km ridden + a reset. The ridden set is local and
 * built from recordings only; resetting clears it so Novelty scores everything as new again.
 */
export function NoveltySettings() {
  const riddenEdges = useNoveltyStore((s) => s.riddenEdges);
  const hydrate = useNoveltyStore((s) => s.hydrate);
  const reset = useNoveltyStore((s) => s.reset);
  const km = useNoveltyStore((s) => s.uniqueKm);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <div className="wr-novelty">
      <p className="wr-muted">
        Explored roads: {riddenEdges.size} cells ≈ {km().toFixed(1)} km unique (from your
        recordings).
      </p>
      {riddenEdges.size > 0 ? (
        <button type="button" className="wr-navlink" onClick={() => void reset()}>
          Reset explored roads
        </button>
      ) : null}
    </div>
  );
}
