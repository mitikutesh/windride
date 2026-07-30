import { useCuratedStore } from '../../state/curatedStore';
import { metresToKm } from '../../utils/units';

/**
 * Provenance for a curated result (WR-052): the official route name, its curation tier and where it
 * meets you. Gated on the `cur-` id prefix, so a badge can never appear on an ordinary plan's card.
 *
 * It also states the one thing the catalog does NOT carry — elevation — because every ETA in this
 * app comes from the speed model, and here that model sees a flat profile.
 */
export function CuratedBadge({ candidateId }: { candidateId: string }) {
  const badge = useCuratedStore((s) => s.badges[candidateId]);
  if (!badge) return null;

  const meets =
    badge.startDistanceM < 250
      ? 'passes your start'
      : `passes ${metresToKm(badge.startDistanceM)} km from your start`;

  return (
    <div className="wr-curated-badge">
      <p className="wr-curated-badge__name">🗺️ {badge.name}</p>
      <p className="wr-curated-badge__meta">
        {badge.label} · {badge.kind === 'loop' ? 'loop' : 'A→B'} ·{' '}
        <span className="tabular">{badge.lengthKm.toFixed(1)} km</span> · {meets}
      </p>
      <p className="wr-muted">
        {badge.partial
          ? 'This signed route is mapped in pieces — you’re seeing its longest continuous section. '
          : ''}
        The catalog carries no elevation, so this ETA assumes a flat profile.
      </p>
    </div>
  );
}
