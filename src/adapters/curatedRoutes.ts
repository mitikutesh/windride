/**
 * adapters/curatedRoutes.ts — load the static curated-route catalog (WR-052, DEC-060).
 *
 * The ONLY fetch in the curated path, and it is same-origin: `public/data/curated-fi.json` is built
 * once by `tools/fetch_curated_routes.mjs` and ships inside the app artefact on the existing
 * S3+CloudFront deploy. No key, no third-party runtime call, no quota — users never touch Bikeland
 * or Overpass. Same static-asset pattern as the WR-018 exposure grid, with one difference: the grid
 * degrades silently to "neutral", while this is loaded because the rider PRESSED a button, so a
 * failure must surface a named cause (DEC-057 taxonomy) instead of an empty screen.
 */
import type { CuratedRoute, CurationTier, LatLon } from '../domain';
import { ProviderError, fetchFailure } from './errors';

/** Bump together with CATALOG_VERSION in tools/curatedCatalog.mjs. */
export const CATALOG_VERSION = 1;

export interface CuratedCatalog {
  version: number;
  /** ISO date (YYYY-MM-DD) the catalog was generated. */
  generated: string;
  /** Required credits for the sources present, shown while curated routes are on screen. */
  attributions: string[];
  routes: CuratedRoute[];
  /** Entries dropped by validation — surfaced so a corrupt rebuild is visible, not invisible. */
  dropped: number;
}

const SOURCES = ['bikeland', 'osm'];
const TIERS = ['icn', 'ncn', 'rcn', 'curated'];
const KINDS = ['loop', 'linear'];

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseBbox(v: unknown): CuratedRoute['bbox'] | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  const minLat = num(b.minLat);
  const minLon = num(b.minLon);
  const maxLat = num(b.maxLat);
  const maxLon = num(b.maxLon);
  if (minLat === null || minLon === null || maxLat === null || maxLon === null) return null;
  if (minLat > maxLat || minLon > maxLon) return null;
  return { minLat, minLon, maxLat, maxLon };
}

function parsePolyline(v: unknown): LatLon[] | null {
  if (!Array.isArray(v)) return null;
  const out: LatLon[] = [];
  for (const pair of v) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const lat = num(pair[0]);
    const lon = num(pair[1]);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    out.push({ lat, lon });
  }
  return out.length >= 2 ? out : null;
}

/**
 * Validate ONE catalog entry. Returns null for anything misshaped: a single bad entry (a truncated
 * rebuild, a hand-edit) must cost that route only — never the whole catalog.
 */
export function parseCuratedRoute(v: unknown): CuratedRoute | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  const id = str(e.id);
  const name = str(e.name);
  const source = str(e.source);
  const tier = str(e.tier);
  const kind = str(e.kind);
  const lengthKm = num(e.lengthKm);
  const attribution = str(e.attribution);
  const bbox = parseBbox(e.bbox);
  const polyline = parsePolyline(e.points);
  if (!id || !name || !attribution || !bbox || !polyline) return null;
  if (!source || !SOURCES.includes(source)) return null;
  if (!tier || !TIERS.includes(tier)) return null;
  if (!kind || !KINDS.includes(kind)) return null;
  if (lengthKm === null || lengthKm <= 0) return null;
  return {
    id,
    name,
    source: source as CuratedRoute['source'],
    tier: tier as CurationTier,
    kind: kind as CuratedRoute['kind'],
    lengthKm,
    bbox,
    attribution,
    partial: e.partial === true,
    polyline,
  };
}

/** Parse the catalog file. Throws only when the FILE is unusable; bad entries are dropped+warned. */
export function parseCuratedCatalog(json: unknown): CuratedCatalog {
  if (!json || typeof json !== 'object') {
    throw new ProviderError('badResponse', 'Curated catalog is not an object', 'bad-catalog');
  }
  const file = json as Record<string, unknown>;
  const version = num(file.version);
  if (version !== CATALOG_VERSION) {
    throw new ProviderError(
      'badResponse',
      `Curated catalog is version ${String(file.version)}, this app reads version ${CATALOG_VERSION}`,
      'stale-catalog',
    );
  }
  if (!Array.isArray(file.routes)) {
    throw new ProviderError('badResponse', 'Curated catalog has no routes array', 'bad-catalog');
  }

  const routes: CuratedRoute[] = [];
  let dropped = 0;
  for (const raw of file.routes) {
    const route = parseCuratedRoute(raw);
    if (route) routes.push(route);
    else dropped++;
  }
  if (dropped > 0) {
    console.warn(
      `curatedRoutes: dropped ${dropped} malformed catalog entr${dropped === 1 ? 'y' : 'ies'}`,
    );
  }

  const attributions = Array.isArray(file.attributions)
    ? file.attributions.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    : [];
  return {
    version: CATALOG_VERSION,
    generated: str(file.generated) ?? '',
    // Fall back to the per-entry credits so attribution can never go missing on an older catalog.
    attributions: attributions.length
      ? attributions
      : [...new Set(routes.map((r) => r.attribution))],
    routes,
    dropped,
  };
}

export interface LoadCuratedOptions {
  fetchFn?: typeof fetch;
  url?: string;
}

// BASE_URL-relative so this same-origin fetch resolves under a subpath deploy too — Vite cannot
// rewrite a runtime fetch string the way it rewrites imported asset URLs (same note as WR-018).
const defaultUrl = () => `${import.meta.env.BASE_URL}data/curated-fi.json`;

let cached: Promise<CuratedCatalog> | null = null;

/**
 * Load + memoise the catalog. The asset is immutable per deploy, so one fetch per session is
 * enough; a FAILED load is not cached, so pressing the button again really retries.
 */
export async function loadCuratedCatalog(opts: LoadCuratedOptions = {}): Promise<CuratedCatalog> {
  if (cached) return cached;
  const pending = fetchCatalog(opts);
  cached = pending;
  try {
    return await pending;
  } catch (e) {
    cached = null;
    throw e;
  }
}

async function fetchCatalog(opts: LoadCuratedOptions): Promise<CuratedCatalog> {
  const fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
  const url = opts.url ?? defaultUrl();
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch {
    throw fetchFailure('Curated catalog', false);
  }
  if (res.status === 404) {
    throw new ProviderError(
      'badResponse',
      'Curated route catalog is not deployed with this build',
      'no-catalog',
    );
  }
  if (!res.ok) throw new ProviderError('badResponse', `Curated catalog HTTP ${res.status}`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ProviderError('badResponse', 'Curated catalog was not JSON', 'bad-catalog');
  }
  return parseCuratedCatalog(json);
}

/** Test seam: forget the memoised catalog (also useful after a service-worker update). */
export function resetCuratedCatalogCache(): void {
  cached = null;
}
