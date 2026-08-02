import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LatLon } from '../../domain';
import { detectGustStretches } from '../../engine/gustFlags';
import { routeToWindGeoJSON, type RouteGeoInput } from '../routeGeo';
import { MAP_COLORS, WIND_COLORS } from '../windColors';
import { DEFAULT_BASEMAP } from '../basemaps';
import {
  addRasterBasemaps,
  applyBasemapVisibility,
  firstSymbolLayerId,
  makeArrowIcon,
} from '../mapLayers';
import { cameraTargetFor, type CameraInsets } from '../mapCamera';
import { BasemapSwitcher } from './BasemapSwitcher';

// OpenFreeMap liberty style — keyless; OSM attribution stays visible (API_NOTES §5).
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * Route line width by zoom (WR-057). The brackets straddle WR-055's two working zooms — cruise is
 * ~z15.9 (219 m across at 25 km/h) and the junction view ~z16.7 (140 m across) — so the line is a
 * thin thread over the whole route and a bold ribbon at a junction.
 */
const ROUTE_WIDTH: maplibregl.ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  12,
  3,
  15.5,
  6,
  17,
  12,
];
/** The casing is the same curve plus a constant outline on each side. */
const ROUTE_CASING_WIDTH: maplibregl.ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  12,
  6,
  15.5,
  10,
  17,
  17,
];

interface RideMapProps {
  /** The route being navigated — the original plan, or the live spliced analysis after a reroute. */
  scored: RouteGeoInput;
  /**
   * `position` is the RAW fix and is where the marker is drawn (WR-051). `anchor` is what the CAMERA
   * follows — the snapped point while on-track, so the basemap does not slide under a stationary
   * chevron on GPS wander at junction zoom; falls back to `position` when absent.
   */
  rider: { position: LatLon; headingDeg: number | null; anchor?: LatLon } | null;
  /** A PROPOSED reroute polyline (confirm flow, WR-051) — drawn dashed until accepted/declined. */
  previewPolyline?: LatLon[] | null;
  /** Battery saver / reduced-motion: snap the follow camera instead of easing. */
  batterySaver?: boolean;
  /** Metres across the view — the follow-camera zoom when riding (else the whole route is fit). */
  zoomM?: number | null;
  /**
   * Follow-the-rider camera on (true) or free-look (false). While false the map stays exactly where
   * the rider dragged/pinched it — the auto-recenter is suspended (Google-Maps navigation pattern).
   */
  following?: boolean;
  /** Called with false the moment the rider pans/pinches the map, so the parent can offer "Recenter". */
  onFollowChange?: (following: boolean) => void;
  /**
   * Heading-up mode (WR-053): rotate the map so up = the rider's direction of travel, Google-Maps
   * style, and sit the rider low so most of the map shows the road ahead. False = classic north-up.
   */
  headingUp?: boolean;
  /**
   * The bearing to rotate to in heading-up mode — `RideState.mapBearingDeg`, which is gated GPS
   * travel only (never the compass, see nav/mapBearing.ts). Null keeps the map north-up.
   */
  mapBearingDeg?: number | null;
  /** Map chrome (turn card above, stats panel below) the rider must not be hidden behind. */
  insets?: CameraInsets;
  /**
   * The junction ahead and the bearing the route LEAVES it on (WR-057) — drawn as an arrow pinned to
   * the node, map-aligned so it keeps pointing down the road whichever way the map faces. Null hides
   * it; the caller decides when it is worth showing.
   */
  junction?: { at: LatLon; outBearingDeg: number } | null;
}

/**
 * Live ride map (WR-016, upgraded): a real basemap (streets / cycling / satellite / terrain via the
 * shared switcher) with the wind-coloured route + direction arrows on top, a heading-oriented rider
 * marker, and a follow-the-rider camera. Degrades to a message where WebGL is unavailable.
 */
export function RideMap({
  scored,
  rider,
  previewPolyline = null,
  batterySaver = false,
  zoomM,
  following = true,
  onFollowChange,
  headingUp = false,
  mapBearingDeg = null,
  insets = { top: 0, bottom: 0 },
  junction = null,
}: RideMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const riderMarkerRef = useRef<maplibregl.Marker | null>(null);
  const junctionMarkerRef = useRef<maplibregl.Marker | null>(null);
  const readyRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP);
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;
  // The one-shot 'you took control' callback, mirrored so the once-attached gesture listeners
  // always call the latest handler.
  const onFollowChangeRef = useRef(onFollowChange);
  onFollowChangeRef.current = onFollowChange;

  // Mirror latest props for the async 'load' handler so first paint uses current data.
  const scoredRef = useRef(scored);
  const riderRef = useRef(rider);
  const previewRef = useRef(previewPolyline);
  const followingRef = useRef(following);
  const junctionRef = useRef(junction);
  scoredRef.current = scored;
  riderRef.current = rider;
  previewRef.current = previewPolyline;
  followingRef.current = following;
  junctionRef.current = junction;
  // Everything the follow camera needs, mirrored so the 'load' handler and the ResizeObserver can
  // re-run it without being wired into React's effect graph.
  const camRef = useRef<CameraOpts>({
    zoomM,
    headingUp,
    mapBearingDeg,
    insets,
    snap: batterySaver,
  });
  camRef.current = { zoomM, headingUp, mapBearingDeg, insets, snap: batterySaver };

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
        // Interactive so the rider can drag/pinch to look around the route mid-ride (the follow
        // camera resumes on Recenter). Rotation is under the app's control only (WR-053 heading-up
        // toggle) — hands-on rotate/tilt stays off so a gloved pinch can't leave the map askew, and
        // pitch stays flat so the wind colours along the route keep their true lengths.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
    } catch {
      setFailed(true); // no WebGL (tests / battery saver) — show the fallback
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation(); // two-finger pinch zooms without spinning the map
    // dragRotate:false leaves the KEYBOARD rotation handler live (shift+arrow), which would spin the
    // map behind React's back and desync the heading-up mode. Rotation is toggle-driven only.
    map.keyboard.disableRotation();
    // Any hands-on gesture drops the follow camera into free-look. dragstart is user-only;
    // zoomstart also fires from the programmatic follow ease, so require a real originalEvent.
    const onGesture = () => onFollowChangeRef.current?.(false);
    map.on('dragstart', onGesture);
    map.on('zoomstart', (e) => {
      if ((e as { originalEvent?: unknown }).originalEvent) onGesture();
    });
    // The container grows when the ride goes full-screen (idle preview → live) while the SAME map is
    // reused; resize the canvas whenever the box changes, else it stays sized to the small preview
    // and renders as a blank dark panel. The camera is re-run too: both the zoom (derived from the
    // container width) and the rider's screen offset (pixels) are stale until the next fix
    // otherwise — indefinitely if GPS has dropped out mid-ride.
    const resizeObserver = new ResizeObserver(() => {
      map.resize();
      if (readyRef.current && followingRef.current) {
        updateCamera(map, riderRef.current, scoredRef.current, camRef.current);
      }
    });
    resizeObserver.observe(container);
    map.on('load', () => {
      readyRef.current = true;
      map.resize(); // in case the container settled its size after map creation
      addRasterBasemaps(map, basemapRef.current);
      map.addSource('wr-route', { type: 'geojson', data: routeToWindGeoJSON(scoredRef.current) });
      // Everything route-related goes BELOW the basemap's label layers (WR-057). The route used to be
      // added with no beforeId, so it painted over street names — and at junction zoom those names are
      // exactly the "other options" the rider is trying to tell our road apart from.
      const labelId = firstSymbolLayerId(map);
      // A dark casing under the wind-coloured line. The default basemap is OpenFreeMap Liberty, a
      // LIGHT style, so the casing must be dark (arrowHalo mirrors --bg) to read at all; a light one
      // would vanish into white and yellow roads.
      map.addLayer(
        {
          id: 'wr-route-casing',
          type: 'line',
          source: 'wr-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': MAP_COLORS.arrowHalo, 'line-width': ROUTE_CASING_WIDTH },
        },
        labelId,
      );
      map.addLayer(
        {
          id: 'wr-route',
          type: 'line',
          source: 'wr-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          // Widens as the rider zooms in (WR-055's junction view sits at ~z16.7): a flat 6 px line
          // stops covering the road it follows once the road itself is 40 px wide, which is precisely
          // where "which way does my route go" gets ambiguous.
          paint: { 'line-color': ['get', 'color'], 'line-width': ROUTE_WIDTH },
        },
        labelId,
      );
      const arrow = makeArrowIcon();
      if (arrow && !map.hasImage('wr-arrow')) map.addImage('wr-arrow', arrow, { pixelRatio: 2 });
      if (map.hasImage('wr-arrow')) {
        map.addLayer(
          {
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
          },
          labelId,
        );
      }
      // Proposed-reroute preview (WR-051): a dashed line the rider can inspect before accepting.
      // Sits above the wind-coloured route so the detour is unmistakable.
      map.addSource('wr-preview', { type: 'geojson', data: previewFC(previewRef.current) });
      map.addLayer({
        id: 'wr-preview',
        type: 'line',
        source: 'wr-preview',
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': MAP_COLORS.start,
          'line-width': 5,
          'line-dasharray': [0.8, 1.6],
        },
      });
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
      updateJunction(map, junctionMarkerRef, junctionRef.current);
      // No ease on the very first frame — there is nothing to animate from.
      updateCamera(map, riderRef.current, scoredRef.current, { ...camRef.current, snap: true });
    });
    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
      riderMarkerRef.current = null;
      junctionMarkerRef.current = null;
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

  // Proposed-reroute preview appears/disappears with the confirm dialog (WR-051).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource('wr-preview') as maplibregl.GeoJSONSource | undefined)?.setData(
      previewFC(previewPolyline),
    );
  }, [previewPolyline]);

  // The rider marker follows every heading change — including the between-fix device-compass
  // refinements, which arrive at sensor rate. Deliberately SEPARATE from the camera effect below:
  // moving a marker is cheap, whereas re-easing the camera at sensor rate interrupts each ease after
  // a frame or two, which would make the rotation speed an artifact of the interrupt cascade.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    updateRider(map, riderMarkerRef, rider);
  }, [rider]);

  // The follow camera runs on real camera inputs only (position, zoom, bearing, mode, chrome) — note
  // the rider's HEADING is absent, so a compass event never re-eases the map. It only follows while
  // `following`; free-look leaves the rider's chosen viewport untouched, and flipping `following`
  // back on (Recenter) recentres here.
  // The junction arrow appears, moves and disappears with the maneuver ahead.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    updateJunction(map, junctionMarkerRef, junction);
  }, [junction]);

  // Keyed on the ANCHOR, not the marker position: on-track those differ, and it is the anchor the
  // camera actually moves to.
  const anchorLat = (rider?.anchor ?? rider?.position)?.lat ?? null;
  const anchorLon = (rider?.anchor ?? rider?.position)?.lon ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !following) return;
    updateCamera(map, riderRef.current, scored, camRef.current);
  }, [
    anchorLat,
    anchorLon,
    zoomM,
    headingUp,
    mapBearingDeg,
    insets.top,
    insets.bottom,
    batterySaver,
    scored,
    following,
  ]);

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

function gustFC(scored: RouteGeoInput) {
  return {
    type: 'FeatureCollection' as const,
    features: detectGustStretches(scored.analysis.segments).map((s) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: [s.midpoint.lon, s.midpoint.lat] },
    })),
  };
}

/** The proposed-reroute polyline as GeoJSON, or an empty collection when there is no proposal. */
function previewFC(polyline: LatLon[] | null | undefined) {
  return {
    type: 'FeatureCollection' as const,
    features:
      polyline && polyline.length >= 2
        ? [
            {
              type: 'Feature' as const,
              properties: {},
              geometry: {
                type: 'LineString' as const,
                coordinates: polyline.map((p) => [p.lon, p.lat] as [number, number]),
              },
            },
          ]
        : [],
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

/**
 * Pin an arrow at the junction ahead, rotated to the bearing the route LEAVES it on. Map-aligned, so
 * it keeps pointing down the road as the map rotates in heading-up mode.
 *
 * A DOM marker rather than a symbol layer: an icon would need a 2d canvas (absent in jsdom, so the
 * layer would silently vanish in tests) and would have to hardcode a hex colour, whereas this styles
 * itself from the design tokens exactly like the rider chevron.
 */
function updateJunction(
  map: maplibregl.Map,
  markerRef: React.MutableRefObject<maplibregl.Marker | null>,
  junction: RideMapProps['junction'],
) {
  if (!junction) {
    markerRef.current?.remove();
    markerRef.current = null;
    return;
  }
  const lngLat: [number, number] = [junction.at.lon, junction.at.lat];
  if (!markerRef.current) {
    const el = document.createElement('div');
    el.className = 'wr-junctionmarker';
    el.innerHTML =
      '<svg viewBox="-12 -12 24 24" width="34" height="34"><path d="M0 -9 L6 3 L0 0 L-6 3 Z"/></svg>';
    markerRef.current = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
      .setLngLat(lngLat)
      .setRotation(junction.outBearingDeg)
      .addTo(map);
    return;
  }
  markerRef.current.setLngLat(lngLat).setRotation(junction.outBearingDeg);
}

/** The camera inputs that are not the rider's position — mirrored in a ref, see camRef. */
interface CameraOpts {
  zoomM: number | null | undefined;
  headingUp: boolean;
  mapBearingDeg: number | null;
  insets: CameraInsets;
  snap: boolean;
}

/**
 * Follow the rider at the requested metres-across zoom and bearing, or fit the whole route before
 * the ride. All the geometry is in mapCamera.cameraTargetFor (pure, unit-tested); this only applies
 * it, because a MapLibre map cannot be constructed in jsdom.
 */
function updateCamera(
  map: maplibregl.Map,
  rider: RideMapProps['rider'],
  scored: RouteGeoInput,
  opts: CameraOpts,
) {
  if (rider) {
    const container = map.getContainer();
    map.easeTo(
      cameraTargetFor({
        // The camera follows the anchor (the snapped point while on-track — see CameraInput.anchor);
        // the MARKER still shows the raw fix, which is what WR-051 is about.
        anchor: rider.anchor ?? rider.position,
        containerW: container.clientWidth || 360,
        containerH: container.clientHeight || 640,
        zoomM: opts.zoomM,
        headingUp: opts.headingUp,
        mapBearingDeg: opts.mapBearingDeg,
        currentBearingDeg: map.getBearing(),
        currentZoom: map.getZoom(),
        insets: opts.insets,
        snap: opts.snap,
      }),
    );
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  for (const p of scored.candidate.polyline) bounds.extend([p.lon, p.lat]);
  // bearing: 0 — the pre-ride overview is always north-up, whatever the last ride left behind.
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 32, duration: 0, bearing: 0 });
}
