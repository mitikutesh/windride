import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LatLon } from '../../domain';
import { detectGustStretches } from '../../engine/gustFlags';
import type { ScoredCandidate } from '../../engine/scoring';
import { routeToWindGeoJSON } from '../routeGeo';
import { MAP_COLORS, WIND_COLORS } from '../windColors';
import { DEFAULT_BASEMAP } from '../basemaps';
import {
  addRasterBasemaps,
  applyBasemapVisibility,
  makeArrowIcon,
  zoomForMetres,
} from '../mapLayers';
import { BasemapSwitcher } from './BasemapSwitcher';

// OpenFreeMap liberty style — keyless; OSM attribution stays visible (API_NOTES §5).
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

interface RideMapProps {
  scored: ScoredCandidate;
  rider: { position: LatLon; headingDeg: number | null } | null;
  /** Battery saver / reduced-motion: snap the follow camera instead of easing. */
  batterySaver?: boolean;
  /** Metres across the view — the follow-camera zoom when riding (else the whole route is fit). */
  zoomM?: number | null;
}

/**
 * Live ride map (WR-016, upgraded): a real basemap (streets / cycling / satellite / terrain via the
 * shared switcher) with the wind-coloured route + direction arrows on top, a heading-oriented rider
 * marker, and a follow-the-rider camera. Degrades to a message where WebGL is unavailable.
 */
export function RideMap({ scored, rider, batterySaver = false, zoomM }: RideMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const riderMarkerRef = useRef<maplibregl.Marker | null>(null);
  const readyRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP);
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;

  // Mirror latest props for the async 'load' handler so first paint uses current data.
  const scoredRef = useRef(scored);
  const riderRef = useRef(rider);
  const zoomRef = useRef(zoomM);
  scoredRef.current = scored;
  riderRef.current = rider;
  zoomRef.current = zoomM;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    const first = scoredRef.current.candidate.polyline[0];
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: STYLE,
        center: [first?.lon ?? 24.65, first?.lat ?? 60.17],
        zoom: 12,
        attributionControl: { compact: true },
        interactive: false, // locked follow-the-rider nav view; zoom via the ride controls
      });
    } catch {
      setFailed(true); // no WebGL (tests / battery saver) — show the fallback
      return;
    }
    mapRef.current = map;
    // The container grows when the ride goes full-screen (idle preview → live) while the SAME map is
    // reused; resize the canvas whenever the box changes, else it stays sized to the small preview
    // and renders as a blank dark panel.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);
    map.on('load', () => {
      readyRef.current = true;
      map.resize(); // in case the container settled its size after map creation
      addRasterBasemaps(map, basemapRef.current);
      map.addSource('wr-route', { type: 'geojson', data: routeToWindGeoJSON(scoredRef.current) });
      map.addLayer({
        id: 'wr-route',
        type: 'line',
        source: 'wr-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 6 },
      });
      const arrow = makeArrowIcon();
      if (arrow && !map.hasImage('wr-arrow')) map.addImage('wr-arrow', arrow, { pixelRatio: 2 });
      if (map.hasImage('wr-arrow')) {
        map.addLayer({
          id: 'wr-route-arrows',
          type: 'symbol',
          source: 'wr-route',
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 70,
            'icon-image': 'wr-arrow',
            'icon-size': 0.85,
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        });
      }
      // Gust-stretch warning markers at each stretch midpoint (WR-021).
      map.addSource('wr-gusts', { type: 'geojson', data: gustFC(scoredRef.current) });
      map.addLayer({
        id: 'wr-gusts',
        type: 'circle',
        source: 'wr-gusts',
        paint: {
          'circle-radius': 6,
          'circle-color': WIND_COLORS.head,
          'circle-opacity': 0.9,
          'circle-stroke-color': MAP_COLORS.arrowHalo,
          'circle-stroke-width': 1.5,
        },
      });
      updateRider(map, riderMarkerRef, riderRef.current);
      updateCamera(map, riderRef.current, zoomRef.current, true, scoredRef.current); // no ease on init
    });
    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
      riderMarkerRef.current = null;
    };
  }, []);

  // Route + gust geometry follow the analysis (swaps on reroute).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource('wr-route') as maplibregl.GeoJSONSource | undefined)?.setData(
      routeToWindGeoJSON(scored),
    );
    (map.getSource('wr-gusts') as maplibregl.GeoJSONSource | undefined)?.setData(gustFC(scored));
  }, [scored]);

  // Rider marker + follow camera on each fix / zoom change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    updateRider(map, riderMarkerRef, rider);
    updateCamera(map, rider, zoomM, batterySaver, scored);
  }, [rider, zoomM, batterySaver, scored]);

  // Basemap switch (Streets = raster hidden → vector base).
  useEffect(() => {
    const map = mapRef.current;
    if (map && readyRef.current) applyBasemapVisibility(map, basemap);
  }, [basemap]);

  return (
    <div className="wr-ridemap" ref={containerRef} data-testid="ride-map">
      {failed ? (
        <span className="wr-map__fallback wr-muted">Map unavailable</span>
      ) : (
        <BasemapSwitcher value={basemap} onChange={setBasemap} />
      )}
    </div>
  );
}

function gustFC(scored: ScoredCandidate) {
  return {
    type: 'FeatureCollection' as const,
    features: detectGustStretches(scored.analysis.segments).map((s) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: [s.midpoint.lon, s.midpoint.lat] },
    })),
  };
}

/** Place/rotate the rider chevron, or remove it when there's no fix yet. */
function updateRider(
  map: maplibregl.Map,
  markerRef: React.MutableRefObject<maplibregl.Marker | null>,
  rider: RideMapProps['rider'],
) {
  if (!rider) {
    markerRef.current?.remove();
    markerRef.current = null;
    return;
  }
  const lngLat: [number, number] = [rider.position.lon, rider.position.lat];
  const rotation = rider.headingDeg ?? 0;
  if (!markerRef.current) {
    const el = document.createElement('div');
    el.className = 'wr-ridemarker';
    // Chevron pointing "up" = heading; setRotation turns it to the travel/compass bearing.
    el.innerHTML =
      '<svg viewBox="-6 -6 12 12" width="30" height="30"><path d="M0 -5 L4 4 L0 2 L-4 4 Z"/></svg>';
    // Set the position BEFORE addTo — addTo reads the marker's lngLat, so attaching without one
    // throws. addTo runs only on creation; later fixes just move the existing marker.
    markerRef.current = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
      .setLngLat(lngLat)
      .setRotation(rotation)
      .addTo(map);
    return;
  }
  markerRef.current.setLngLat(lngLat).setRotation(rotation);
}

/** Follow the rider at the requested metres-across zoom, or fit the whole route before the ride. */
function updateCamera(
  map: maplibregl.Map,
  rider: RideMapProps['rider'],
  zoomM: number | null | undefined,
  batterySaver: boolean,
  scored: ScoredCandidate,
) {
  if (rider) {
    const width = map.getContainer().clientWidth || 360;
    const across = zoomM && zoomM > 0 ? zoomM : 600;
    const zoom = zoomForMetres(across, rider.position.lat, width);
    map.easeTo({
      center: [rider.position.lon, rider.position.lat],
      zoom,
      duration: batterySaver ? 0 : 500,
    });
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  for (const p of scored.candidate.polyline) bounds.extend([p.lon, p.lat]);
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 32, duration: 0 });
}
