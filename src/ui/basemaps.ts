// ui/basemaps.ts — selectable map backgrounds for the Results route map (all free, no API key).
//
// The Streets base is the OpenFreeMap vector style already used by RouteMap. The other three are
// raster tile layers laid OVER that vector base (below the route lines) and toggled by visibility —
// so switching never reloads the style or drops the route. Attribution for each source is required
// and surfaced by MapLibre's attribution control. Live traffic is intentionally absent: no provider
// offers it on a free/keyless tier (see DEC-035).

export type BasemapId = 'streets' | 'cycling' | 'satellite' | 'terrain';

export interface RasterBasemap {
  tiles: string[];
  tileSize: number;
  maxzoom: number;
  /** Shown in the map's attribution control while this layer is visible (licence requirement). */
  attribution: string;
  /**
   * Insert this raster BELOW the vector base's label layers so street/place names render over it —
   * the Google-style "hybrid" look. Only for imagery with no labels of its own (Satellite); layers
   * that carry their own labels (CyclOSM, OpenTopoMap) leave it off and sit on top.
   */
  overlayLabels?: boolean;
}

export interface Basemap {
  id: BasemapId;
  label: string;
  /** Raster overlay; undefined means "the vector street base itself" (no overlay). */
  raster?: RasterBasemap;
}

export const BASEMAPS: Basemap[] = [
  { id: 'streets', label: 'Streets' }, // the OpenFreeMap vector base (no raster overlay)
  {
    id: 'cycling',
    label: 'Cycling',
    // CyclOSM — an OSM style purpose-built for cyclists (cycleways, bike lanes, surface, MTB trails).
    raster: {
      tiles: [
        'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
        'https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
        'https://c.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      maxzoom: 20,
      attribution: 'CyclOSM | Map data © OpenStreetMap contributors',
    },
  },
  {
    id: 'satellite',
    label: 'Satellite',
    // Esri World Imagery — note the {z}/{y}/{x} order (ArcGIS uses row/col, not the usual x/y).
    raster: {
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
      overlayLabels: true, // imagery has no labels — keep the vector street/place names on top
    },
  },
  {
    id: 'terrain',
    label: 'Terrain',
    // OpenTopoMap — shaded relief + contours, useful for reading climbs on hilly routes.
    raster: {
      tiles: [
        'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Map data: © OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)',
    },
  },
];

export const DEFAULT_BASEMAP: BasemapId = 'streets';

/** MapLibre source/layer id for a raster basemap (stable, so visibility toggles can find it). */
export function basemapLayerId(id: BasemapId): string {
  return `wr-base-${id}`;
}

/** The raster basemaps only (the vector Streets base has no overlay layer). */
export function rasterBasemaps(): Basemap[] {
  return BASEMAPS.filter((b) => b.raster);
}
