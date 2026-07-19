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
  /** Metres across the view — when set AND riding, follow the rider at this zoom (else fit the route). */
  zoomM?: number | null;
}

const M_PER_DEG_LAT = 111_320;

const VIEW = 100;
const PAD = 8;

/**
 * Lightweight ride map (WR-016): the route ahead drawn wind-coloured as SVG, with a heading-oriented
 * rider chevron that pulses. SVG (not WebGL) keeps it glanceable, low-power, and testable; battery
 * saver / reduced-motion drop the pulse. (A full basemap can layer under this later.)
 */
export function RideMap({ scored, rider, batterySaver = false, zoomM }: RideMapProps) {
  const fc = useMemo(() => routeToWindGeoJSON(scored), [scored]);

  const project = useMemo(() => {
    // Follow-the-rider zoom: centre on the rider with `zoomM` metres across the padded view. The SVG
    // viewBox clips the route beyond the window, so this reads as a zoomed nav view.
    if (zoomM && zoomM > 0 && rider) {
      const { lat, lon } = rider.position;
      const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
      const scale = (VIEW - 2 * PAD) / zoomM; // SVG units per metre
      return (plon: number, plat: number): [number, number] => [
        VIEW / 2 + (plon - lon) * mPerDegLon * scale,
        VIEW / 2 - (plat - lat) * M_PER_DEG_LAT * scale, // flip Y so north is up
      ];
    }
    // Overview: fit the whole route.
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
  }, [fc, rider, zoomM]);

  const riderXY = rider ? project(rider.position.lon, rider.position.lat) : null;
  // Gust-stretch warning markers at each stretch midpoint (WR-021). Detect once per route (heavy,
  // over all segments); only the projection re-runs per fix as the follow-map pans/zooms.
  const gustStretches = useMemo(() => detectGustStretches(scored.analysis.segments), [scored]);
  const gustMarkers = useMemo(
    () => gustStretches.map((s) => project(s.midpoint.lon, s.midpoint.lat)),
    [gustStretches, project],
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
