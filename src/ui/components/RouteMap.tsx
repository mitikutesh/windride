import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ScoredCandidate } from '../../engine/scoring';
import { routeToWindGeoJSON } from '../routeGeo';
import { MAP_COLORS } from '../windColors';

// OpenFreeMap liberty style — keyless; OSM attribution stays visible (API_NOTES §5).
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

interface RouteMapProps {
  candidates: ScoredCandidate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * MapLibre route map (WR-009). Created once; sources are updated imperatively (no React churn).
 * The selected route is one GeoJSON source coloured per feature; the rest are faint tappable
 * ghosts. Degrades to a plain message where WebGL is unavailable (jsdom/tests, battery saver).
 */
export function RouteMap({ candidates, selectedId, onSelect }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const readyRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE,
        center: [24.65, 60.17],
        zoom: 9,
        attributionControl: { compact: false },
      });
    } catch {
      return; // no WebGL (tests / battery saver) — the fallback text stays visible
    }
    mapRef.current = map;
    map.on('load', () => {
      readyRef.current = true;
      map.addSource('wr-ghosts', { type: 'geojson', data: emptyFC() });
      map.addLayer({
        id: 'wr-ghosts',
        type: 'line',
        source: 'wr-ghosts',
        paint: { 'line-color': MAP_COLORS.ghost, 'line-width': 3, 'line-opacity': 0.35 },
      });
      map.addSource('wr-selected', { type: 'geojson', data: emptyFC() });
      map.addLayer({
        id: 'wr-selected',
        type: 'line',
        source: 'wr-selected',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 5 },
      });
      map.on('click', 'wr-ghosts', (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === 'string') onSelectRef.current(id);
      });
      map.on('mouseenter', 'wr-ghosts', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'wr-ghosts', () => (map.getCanvas().style.cursor = ''));
      draw(map, markerRef, candidates, selectedId);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map && readyRef.current) draw(map, markerRef, candidates, selectedId);
  }, [candidates, selectedId]);

  return (
    <div className="wr-map" ref={containerRef} data-testid="route-map">
      <span className="wr-map__fallback wr-muted">Map unavailable</span>
    </div>
  );
}

function emptyFC() {
  return { type: 'FeatureCollection' as const, features: [] };
}

function draw(
  map: maplibregl.Map,
  markerRef: React.MutableRefObject<maplibregl.Marker | null>,
  candidates: ScoredCandidate[],
  selectedId: string | null,
) {
  const ghosts = {
    type: 'FeatureCollection' as const,
    features: candidates
      .filter((c) => c.candidate.id !== selectedId)
      .map((c) => ({
        type: 'Feature' as const,
        properties: { id: c.candidate.id },
        geometry: {
          type: 'LineString' as const,
          coordinates: c.candidate.polyline.map((p) => [p.lon, p.lat]),
        },
      })),
  };
  (map.getSource('wr-ghosts') as maplibregl.GeoJSONSource | undefined)?.setData(ghosts);

  const selected = candidates.find((c) => c.candidate.id === selectedId);
  if (!selected) return;
  (map.getSource('wr-selected') as maplibregl.GeoJSONSource | undefined)?.setData(
    routeToWindGeoJSON(selected),
  );

  const start = selected.candidate.polyline[0];
  if (start) {
    markerRef.current?.remove();
    markerRef.current = new maplibregl.Marker({ color: MAP_COLORS.start })
      .setLngLat([start.lon, start.lat])
      .addTo(map);
  }

  const bounds = new maplibregl.LngLatBounds();
  for (const p of selected.candidate.polyline) bounds.extend([p.lon, p.lat]);
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, duration: 400 });
}
