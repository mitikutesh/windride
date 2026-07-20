import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { ScoredCandidate } from '../../engine/scoring';
import { routeToWindGeoJSON } from '../routeGeo';
import { MAP_COLORS } from '../windColors';
import { BasemapSwitcher } from './BasemapSwitcher';
import { type BasemapId, DEFAULT_BASEMAP, basemapLayerId, rasterBasemaps } from '../basemaps';

// OpenFreeMap liberty style — keyless; OSM attribution stays visible (API_NOTES §5).
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

interface RouteMapProps {
  candidates: ScoredCandidate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** The first label (symbol) layer of the base style — imagery inserted before it keeps labels on top. */
function firstSymbolLayerId(map: maplibregl.Map): string | undefined {
  return map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
}

/** Add the raster basemaps over the vector base but under the route layers; only `active` visible. */
function addRasterBasemaps(map: maplibregl.Map, active: BasemapId): void {
  const labelId = firstSymbolLayerId(map);
  for (const b of rasterBasemaps()) {
    if (!b.raster) continue;
    const srcId = basemapLayerId(b.id);
    if (!map.getSource(srcId)) {
      map.addSource(srcId, {
        type: 'raster',
        tiles: b.raster.tiles,
        tileSize: b.raster.tileSize,
        maxzoom: b.raster.maxzoom,
        attribution: b.raster.attribution,
      });
    }
    if (!map.getLayer(srcId)) {
      // Label-less imagery (Satellite) goes BELOW the vector labels so street/place names stay
      // legible (hybrid look); layers with their own labels sit on top.
      const beforeId = b.raster.overlayLabels ? labelId : undefined;
      map.addLayer(
        {
          id: srcId,
          type: 'raster',
          source: srcId,
          layout: { visibility: b.id === active ? 'visible' : 'none' },
        },
        beforeId,
      );
    }
  }
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
  const [failed, setFailed] = useState(false);
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP);
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;

  // Mirror latest props into refs so the async 'load' handler always draws the current selection.
  const onSelectRef = useRef(onSelect);
  const candidatesRef = useRef(candidates);
  const selectedRef = useRef(selectedId);
  onSelectRef.current = onSelect;
  candidatesRef.current = candidates;
  selectedRef.current = selectedId;

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
      setFailed(true); // no WebGL (tests / battery saver) — show the fallback
      return;
    }
    mapRef.current = map;
    map.on('load', () => {
      readyRef.current = true;
      // Raster basemaps first (over the vector base) so the route layers added below sit on top.
      addRasterBasemaps(map, basemapRef.current);
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
      // Direction arrows along the selected route (WR follow-up): the polyline is in the exact order
      // the wind engine scored (start → around → home), so arrows show which way to ride the loop.
      const arrow = makeArrowIcon();
      if (arrow && !map.hasImage('wr-arrow')) map.addImage('wr-arrow', arrow, { pixelRatio: 2 });
      if (map.hasImage('wr-arrow')) {
        map.addLayer({
          id: 'wr-selected-arrows',
          type: 'symbol',
          source: 'wr-selected',
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
      map.on('click', 'wr-ghosts', (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === 'string') onSelectRef.current(id);
      });
      map.on('mouseenter', 'wr-ghosts', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'wr-ghosts', () => (map.getCanvas().style.cursor = ''));
      draw(map, markerRef, candidatesRef.current, selectedRef.current);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map && readyRef.current) draw(map, markerRef, candidates, selectedId);
  }, [candidates, selectedId]);

  // Toggle raster basemap visibility when the chosen layer changes (Streets = all raster hidden).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    for (const b of rasterBasemaps()) {
      const id = basemapLayerId(b.id);
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', b.id === basemap ? 'visible' : 'none');
      }
    }
  }, [basemap]);

  return (
    <div className="wr-map" ref={containerRef} data-testid="route-map">
      {failed ? (
        <span className="wr-map__fallback wr-muted">Map unavailable</span>
      ) : (
        <BasemapSwitcher value={basemap} onChange={setBasemap} />
      )}
    </div>
  );
}

function emptyFC() {
  return { type: 'FeatureCollection' as const, features: [] };
}

/** A right-pointing chevron (light fill + dark halo) for the along-route direction arrows. */
function makeArrowIcon(): ImageData | null {
  const scale = 2; // draw at 2× for a crisp icon (added with pixelRatio: 2)
  const size = 24 * scale;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const chevron = () => {
    ctx.beginPath();
    ctx.moveTo(7, 5);
    ctx.lineTo(17, 12);
    ctx.lineTo(7, 19);
    ctx.stroke();
  };
  ctx.strokeStyle = MAP_COLORS.arrowHalo;
  ctx.lineWidth = 6;
  chevron();
  ctx.strokeStyle = MAP_COLORS.arrow;
  ctx.lineWidth = 3;
  chevron();
  return ctx.getImageData(0, 0, size, size);
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

  const selectedSource = map.getSource('wr-selected') as maplibregl.GeoJSONSource | undefined;
  const selected = candidates.find((c) => c.candidate.id === selectedId);
  if (!selected) {
    selectedSource?.setData(emptyFC());
    markerRef.current?.remove();
    markerRef.current = null;
    return;
  }
  selectedSource?.setData(routeToWindGeoJSON(selected));

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
