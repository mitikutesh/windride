import { useMemo } from 'react';
import type { LatLon } from '../../domain';
import { detectGustStretches } from '../../engine/gustFlags';
import type { ScoredCandidate } from '../../engine/scoring';
import { routeToWindGeoJSON } from '../routeGeo';
import { windColor } from '../windColors';

interface RideMapProps {
  scored: ScoredCandidate;
  rider: { position: LatLon; headingDeg: number | null } | null;
  /** Battery saver / reduced-motion: draw a static map, no chevron pulse. */
  batterySaver?: boolean;
}

const VIEW = 100;
const PAD = 8;

/**
 * Lightweight ride map (WR-016): the route ahead drawn wind-coloured as SVG, with a heading-oriented
 * rider chevron that pulses. SVG (not WebGL) keeps it glanceable, low-power, and testable; battery
 * saver / reduced-motion drop the pulse. (A full basemap can layer under this later.)
 */
export function RideMap({ scored, rider, batterySaver = false }: RideMapProps) {
  const fc = useMemo(() => routeToWindGeoJSON(scored), [scored]);

  const project = useMemo(() => {
    const coords = fc.features.flatMap((f) => f.geometry.coordinates);
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const midLat = (minLat + maxLat) / 2;
    const cos = Math.cos((midLat * Math.PI) / 180);
    const spanX = Math.max(1e-9, (maxLon - minLon) * cos);
    const spanY = Math.max(1e-9, maxLat - minLat);
    const scale = (VIEW - 2 * PAD) / Math.max(spanX, spanY);
    const offX = (VIEW - spanX * scale) / 2;
    const offY = (VIEW - spanY * scale) / 2;
    return (lon: number, lat: number): [number, number] => [
      offX + (lon - minLon) * cos * scale,
      // Flip Y so north is up.
      offY + (maxLat - lat) * scale,
    ];
  }, [fc]);

  const riderXY = rider ? project(rider.position.lon, rider.position.lat) : null;
  // Gust-stretch warning markers at each stretch midpoint (WR-021).
  const gustMarkers = useMemo(
    () =>
      detectGustStretches(scored.analysis.segments).map((s) =>
        project(s.midpoint.lon, s.midpoint.lat),
      ),
    [scored, project],
  );

  return (
    <svg
      className="wr-ridemap"
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      role="img"
      aria-label="Route ahead, coloured by wind"
      preserveAspectRatio="xMidYMid meet"
    >
      {fc.features.map((f, i) => {
        const pts = f.geometry.coordinates
          .map(([lon, lat]) => project(lon, lat).join(','))
          .join(' ');
        return (
          <polyline
            key={i}
            points={pts}
            fill="none"
            stroke={windColor(f.properties.kind)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
      {gustMarkers.map(([x, y], i) => (
        <circle key={`gust-${i}`} className="wr-ridemap__gust" cx={x} cy={y} r={2.5} />
      ))}
      {riderXY ? (
        <g transform={`translate(${riderXY[0]} ${riderXY[1]}) rotate(${rider?.headingDeg ?? 0})`}>
          {!batterySaver ? <circle className="wr-ridemap__pulse" r={5} /> : null}
          {/* Chevron pointing "up" = current heading. */}
          <path className="wr-ridemap__chevron" d="M0 -4 L3 3 L0 1 L-3 3 Z" />
        </g>
      ) : null}
    </svg>
  );
}
