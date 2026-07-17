import { useEffect } from 'react';
import { loadRidePoints } from '../../nav/recorder';
import { useRidesStore } from '../../state/ridesStore';
import { gpxFilename, toGpx } from '../../utils/gpx';
import { formatDurationHM, localYMD, metresToKm, msToKmh } from '../../utils/units';
import { downloadText } from '../download';

/** Recorded ride history (WR-017): date, name, stats, with delete + GPX re-export. */
export function RideHistory() {
  const rides = useRidesStore((s) => s.rides);
  const refresh = useRidesStore((s) => s.refresh);
  const remove = useRidesStore((s) => s.remove);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (rides.length === 0) return null;

  const exportRide = async (id: string, name: string, distanceM: number) => {
    const points = await loadRidePoints(id);
    const xml = toGpx({ name, points });
    downloadText(gpxFilename(distanceM / 1000, localYMD(new Date())), 'application/gpx+xml', xml);
  };

  return (
    <section className="wr-history" aria-label="Ride history">
      <h2>Ride history</h2>
      <ul className="wr-history__list">
        {rides.map((r) => (
          <li key={r.id} className="wr-history__item">
            <div className="wr-history__meta">
              <span className="wr-history__name">{r.name}</span>
              <span className="wr-muted">
                {localYMD(new Date(r.startedAt))}
                {r.summary
                  ? ` · ${metresToKm(r.summary.distanceM)} km · ${formatDurationHM(r.summary.movingS)} · ${msToKmh(r.summary.avgSpeedMs)} km/h`
                  : ''}
              </span>
            </div>
            <div className="wr-history__actions">
              <button
                type="button"
                className="wr-navlink"
                onClick={() => void exportRide(r.id, r.name, r.summary?.distanceM ?? 0)}
              >
                GPX
              </button>
              <button type="button" className="wr-navlink" onClick={() => void remove(r.id)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
