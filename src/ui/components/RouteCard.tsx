import { ROBUST_SPREAD_THRESHOLD_MS, type ScoredCandidate } from '../../engine/scoring';
import { formatDurationHM } from '../../utils/units';
import { routeToRibbon } from '../routeGeo';
import { ScoreRing } from './ScoreRing';
import { StatCell } from './StatCell';
import { WindRibbon } from './WindRibbon';

const NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

interface RouteCardProps {
  scored: ScoredCandidate;
  rank: number;
  selected: boolean;
  onSelect: () => void;
}

/** A ranked candidate card (WR-009): score ring, wind-aware stats, ribbon, explanation. */
export function RouteCard({ scored, rank, selected, onSelect }: RouteCardProps) {
  const e = scored.evidence;
  const name = `Route ${NAMES[rank - 1] ?? rank}`;
  return (
    <div
      className={['wr-card', selected ? 'is-selected' : ''].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${name}, score ${Math.round(scored.total)}`}
      onClick={onSelect}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="wr-card__head">
        <div>
          <div className="wr-card__rank">#{rank}</div>
          <div className="wr-card__name">{name}</div>
          <div className="wr-muted tabular">{e.distanceKm.toFixed(1)} km</div>
        </div>
        <ScoreRing score={scored.total} size={72} />
      </div>

      <div className="wr-card__stats">
        <StatCell label="Distance" value={e.distanceKm.toFixed(1)} unit="km" />
        <StatCell label="Wind-aware ETA" value={formatDurationHM(e.timeS)} />
        <StatCell label="Ascent" value={Math.round(e.ascentM)} unit="m" />
        <StatCell label="Direct headwind" value={e.directHeadwindKm.toFixed(1)} unit="km" />
      </div>

      {e.gustyKm > 0 ? (
        <p className="wr-card__gust" role="note">
          ⚠ {e.gustyKm.toFixed(1)} km exposed crosswind, gusts {Math.round(e.maxGustMs)} m/s
        </p>
      ) : null}

      {e.noveltyShare < 1 ? (
        <p className="wr-card__novelty" role="note">
          {Math.round(e.noveltyShare * 100)}% new roads
        </p>
      ) : null}

      {(() => {
        // Forecast-robustness marker (WR-025). Deliberately QUALITY-NEUTRAL: it reports how much a
        // 30°-wrong forecast would worsen the ride, NOT whether the ride is good. A poor route can be
        // "forecast-stable" (already bad, a shift barely changes it) — overall quality is the score
        // ring, not this badge (review MAJOR 2). Only the sensitive case is coloured, as a caution.
        const stable = e.robustnessSpreadMs < ROBUST_SPREAD_THRESHOLD_MS;
        return (
          <p
            className={`wr-card__robust ${stable ? 'is-stable' : 'is-sensitive'}`}
            role="note"
            title="Extra effective headwind if the forecast direction is 30° off"
          >
            {stable ? '✓ forecast-stable' : '△ forecast-sensitive'} · ±30°: +
            {e.robustnessSpreadMs.toFixed(1)} m/s
          </p>
        );
      })()}

      <WindRibbon segments={routeToRibbon(scored)} height={12} />
      <p className="wr-card__explain">{scored.explanation}</p>
    </div>
  );
}
