import type { LatLon } from '../../domain';
import { usePoiStore } from '../../state/poiStore';

interface Props {
  route: { id: string; polyline: LatLon[] };
}

/**
 * "Scenic spots along this route" (WR-048): on-demand, keyless Wikimedia Commons photos near the
 * route. A pure view over poiStore (UI never touches adapters). Tagged by routeId so it only shows
 * results for the currently-selected route.
 */
export function ScenicSpots({ route }: Props) {
  const status = usePoiStore((s) => s.status);
  const pois = usePoiStore((s) => s.pois);
  const error = usePoiStore((s) => s.error);
  const routeId = usePoiStore((s) => s.routeId);
  const loadForRoute = usePoiStore((s) => s.loadForRoute);

  const forThisRoute = routeId === route.id;
  const loading = forThisRoute && status === 'loading';
  const ready = forThisRoute && status === 'ready';

  return (
    <div className="wr-scenic">
      {ready && pois.length > 0 ? (
        <ul className="wr-scenic__grid">
          {pois.map((p) => (
            <li key={p.pageUrl} className="wr-scenic__item">
              <a href={p.pageUrl} target="_blank" rel="noopener noreferrer">
                <img
                  className="wr-scenic__thumb"
                  src={p.thumbUrl}
                  alt={p.title}
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
                <span className="wr-scenic__caption">{p.title}</span>
              </a>
              {/* Per-image attribution — Commons files are individually licensed (DEC-047). */}
              <span className="wr-scenic__credit">
                {p.artist ?? 'Unknown author'}
                {p.license ? (
                  <>
                    {' · '}
                    {p.licenseUrl ? (
                      <a href={p.licenseUrl} target="_blank" rel="noopener noreferrer">
                        {p.license}
                      </a>
                    ) : (
                      p.license
                    )}
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {ready && pois.length === 0 ? (
        <p className="wr-muted">No scenic photos found near this route.</p>
      ) : null}

      <button
        type="button"
        className="wr-navlink"
        onClick={() => void loadForRoute(route)}
        disabled={loading}
      >
        {loading ? 'Looking…' : ready ? 'Refresh scenic spots' : 'Show scenic spots'}
      </button>
      {forThisRoute && status === 'error' ? <p className="wr-muted">{error}</p> : null}
      <p className="wr-muted wr-scenic__credit">Photos via Wikimedia Commons.</p>
    </div>
  );
}
