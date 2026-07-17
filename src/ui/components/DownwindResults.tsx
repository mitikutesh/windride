import type { DownwindResult } from '../../state/plan/runDownwindPlan';
import { formatDurationHM } from '../../utils/units';

/**
 * Downwind one-way results (WR-026): ranked stations you can ride downwind to and take transit back.
 * Card copy leads with the wind payoff and the honest return service ("trains every ~30 min from
 * 18:40 · bike space not guaranteed"); with no Digitransit key it says "check return times".
 */
export function DownwindResults({ results }: { results: DownwindResult[] }) {
  if (results.length === 0) return null;
  return (
    <section className="wr-downwind" aria-label="Downwind one-way rides">
      <h2>Downwind one-ways</h2>
      <ul className="wr-downwind__list">
        {results.map((r) => (
          <li key={r.endpoint.station.id} className="wr-downwind__item">
            <div className="wr-downwind__head">
              <span className="wr-downwind__name">{r.endpoint.station.name}</span>
              <span className="wr-muted tabular">
                {(r.endpoint.distanceM / 1000).toFixed(0)} km
              </span>
            </div>
            <div className="wr-muted tabular">
              {Math.round(r.tailwindShare * 100)}% tailwind · ETA{' '}
              {formatDurationHM(r.scored.analysis.totalTimeS)}
            </div>
            <div className="wr-downwind__return">
              {r.return
                ? r.return.label
                : 'Return service unknown — check return times · bike space not guaranteed'}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
