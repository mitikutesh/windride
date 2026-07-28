import { useEffect } from 'react';
import { loadRidePoints } from '../../nav/recorder';
import { useRidesStore } from '../../state/ridesStore';
import { RideRecap } from './RideRecap';
import { gpxFilename, toGpx } from '../../utils/gpx';
import { formatDurationHM, localYMD, metresToKm, msToKmh } from '../../utils/units';
import { downloadText } from '../download';

/** Recorded ride history (WR-017): date, name, stats, with delete + GPX re-export. */
const STRAVA_LABEL: Record<string, string> = {
  pending: 'Sending…',
  duplicate: 'Already on Strava',
  error: 'Strava failed, tap to retry',
  'no-creds': 'Set up Strava in Kit',
};

export function RideHistory() {
  const rides = useRidesStore((s) => s.rides);
  const refresh = useRidesStore((s) => s.refresh);
  const remove = useRidesStore((s) => s.remove);
  const strava = useRidesStore((s) => s.strava);
  const stravaError = useRidesStore((s) => s.stravaError);
  const stravaErrorCode = useRidesStore((s) => s.stravaErrorCode);
  const sendToStrava = useRidesStore((s) => s.sendToStrava);

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
            <div className="wr-history__head">
              <span className="wr-history__name">{r.name}</span>
              <span className="wr-history__date tabular">{localYMD(new Date(r.startedAt))}</span>
            </div>
            {r.summary ? (
              <div className="wr-history__stats tabular">
                <span>{metresToKm(r.summary.distanceM)} km</span>
                <span>{formatDurationHM(r.summary.movingS)}</span>
                <span>{msToKmh(r.summary.avgSpeedMs)} km/h</span>
              </div>
            ) : null}
            <div className="wr-history__actions">
              <button
                type="button"
                className="wr-btn--mini"
                onClick={() => void exportRide(r.id, r.name, r.summary?.distanceM ?? 0)}
              >
                GPX
              </button>
              {r.stravaActivityId ? (
                <span className="wr-muted wr-history__onstrava">On Strava ✓</span>
              ) : (
                <button
                  type="button"
                  className="wr-btn--mini"
                  disabled={strava[r.id] === 'pending'}
                  onClick={() => void sendToStrava(r.id)}
                  title={strava[r.id] === 'error' ? stravaError[r.id] : undefined}
                >
                  {strava[r.id] === 'error' && stravaError[r.id]
                    ? stravaError[r.id]
                    : (STRAVA_LABEL[strava[r.id] ?? ''] ?? 'Send to Strava')}
                </button>
              )}
              {/* Kit fixes auth/scope (re-authorise, activity:write) + the no-creds case; a
                  rate/network error is retry-only, so no misleading "fix in Kit" there (WR-050). */}
              {strava[r.id] === 'no-creds' || stravaErrorCode[r.id] === 'auth' ? (
                <a
                  className="wr-btn--mini"
                  href="#/kit"
                  title="Re-authorise Strava with activity:write, then paste the new refresh token"
                >
                  Fix in Kit → Strava
                </a>
              ) : null}
              <button type="button" className="wr-btn--mini" onClick={() => void remove(r.id)}>
                Delete
              </button>
            </div>
            <RideRecap ride={r} />
          </li>
        ))}
      </ul>
    </section>
  );
}
