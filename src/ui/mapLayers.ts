// ui/mapLayers.ts — MapLibre helpers shared by the Results map (RouteMap) and the ride map (RideMap):
// the raster basemap layers (DEC-035) and the along-route direction arrow icon. Kept here so both
// maps use one source of truth. The follow-camera maths lives in mapCamera.ts (pure, unit-tested).
import maplibregl from 'maplibre-gl';
import { type BasemapId, basemapLayerId, rasterBasemaps } from './basemaps';
import { MAP_COLORS } from './windColors';

/** The first label (symbol) layer of the base style — imagery inserted before it keeps labels on top. */
export function firstSymbolLayerId(map: maplibregl.Map): string | undefined {
  return map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
}

/** Add the raster basemaps over the vector base but under whatever is added next; only `active` visible. */
export function addRasterBasemaps(map: maplibregl.Map, active: BasemapId): void {
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
      // Label-less imagery (Satellite) goes BELOW the vector labels so names stay legible.
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

/** Toggle which raster basemap is visible (Streets = all hidden → the vector base shows through). */
export function applyBasemapVisibility(map: maplibregl.Map, active: BasemapId): void {
  for (const b of rasterBasemaps()) {
    const id = basemapLayerId(b.id);
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', b.id === active ? 'visible' : 'none');
    }
  }
}

/** A right-pointing chevron (light fill + dark halo) for the along-route direction arrows. */
export function makeArrowIcon(): ImageData | null {
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
