// state/poiStore.ts — scenic photos / POI highlights along a route (WR-048).
// On-demand (a click), keyless (Wikimedia Commons), so it's not gated on AI. The UI never touches
// adapters — this store owns the provider call, samples a few points along the route to cover it,
// dedupes, and exposes a plain status machine. Tagged by routeId so a stale result never shows for
// a route the user has since switched away from.
import { create } from 'zustand';
import type { LatLon } from '../domain';
import { WikimediaPoiProvider, type Poi, type PoiProvider } from '../adapters/poi/wikimedia';

type Status = 'idle' | 'loading' | 'ready' | 'error';

const SEARCH_RADIUS_M = 1500;
const PER_POINT = 5;
const SAMPLE_POINTS = 4;
const MAX_POIS = 12;

/** Evenly pick up to `n` points along a polyline by index (endpoints included) to cover the route. */
export function samplePolyline(polyline: LatLon[], n: number): LatLon[] {
  if (polyline.length === 0) return [];
  if (n <= 1 || polyline.length === 1) return [polyline[0]];
  if (polyline.length <= n) return [...polyline];
  const step = (polyline.length - 1) / (n - 1);
  const out: LatLon[] = [];
  for (let i = 0; i < n; i++) out.push(polyline[Math.round(i * step)]);
  return out;
}

interface PoiState {
  status: Status;
  pois: Poi[];
  error: string | null;
  routeId: string | null;
  loadForRoute: (
    route: { id: string; polyline: LatLon[] },
    deps?: { provider?: PoiProvider },
  ) => Promise<void>;
  reset: () => void;
}

export const usePoiStore = create<PoiState>((set, get) => ({
  status: 'idle',
  pois: [],
  error: null,
  routeId: null,

  loadForRoute: async (route, deps) => {
    const provider = deps?.provider ?? new WikimediaPoiProvider();
    set({ status: 'loading', error: null, pois: [], routeId: route.id });
    try {
      const points = samplePolyline(route.polyline, SAMPLE_POINTS);
      // A dead point (no photos / a failed query) must not sink the whole strip — swallow per point
      // to null so we can still tell "all points failed" (offline) from "found nothing".
      const batches = await Promise.all(
        points.map((p) => provider.nearbyPhotos(p, SEARCH_RADIUS_M, PER_POINT).catch(() => null)),
      );
      if (get().routeId !== route.id) return; // user switched routes mid-flight — drop stale result

      const failed = batches.filter((b) => b === null).length;
      if (points.length > 0 && failed === points.length) {
        // Every query failed → a real error, not an honest "nothing here".
        set({ status: 'error', error: 'Could not reach Wikimedia for scenic spots.', pois: [] });
        return;
      }

      const seen = new Set<string>();
      const pois: Poi[] = [];
      for (const poi of batches.flat()) {
        if (poi === null || seen.has(poi.pageUrl)) continue; // dedupe on the unique file-page URL
        seen.add(poi.pageUrl);
        pois.push(poi);
        if (pois.length >= MAX_POIS) break;
      }
      set({ status: 'ready', pois, error: null });
    } catch {
      if (get().routeId !== route.id) return;
      set({ status: 'error', error: 'Could not load scenic spots right now.', pois: [] });
    }
  },

  reset: () => set({ status: 'idle', pois: [], error: null, routeId: null }),
}));
