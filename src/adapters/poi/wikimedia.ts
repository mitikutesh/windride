/**
 * adapters/poi/wikimedia.ts — scenic photos + POI highlights near a route (WR-048).
 *
 * Wikimedia Commons geosearch: free, keyless, and CORS-enabled for anonymous requests (origin=*),
 * so it fits the BYO/zero-cost model with nothing to configure. One of the few places fetch() may
 * appear (CLAUDE.md rule 4). NOT Strava (its photos are off-limits, CLAUDE.md).
 *
 * Commons has no blanket licence — every file is individually PD/CC0/CC-BY(-SA)/… — so each photo
 * carries its own author + licence (from `extmetadata`), rendered as required attribution (DEC-047),
 * alongside a link to the file page. Per-point results are cached in idb (24 h) so re-clicks and
 * route toggles don't refetch (WR-048 budget).
 */
import type { LatLon } from '../../domain';
import { ProviderError } from '../errors';
import { createIdbCache, type TtlCache } from '../idbCache';

export interface Poi {
  title: string;
  thumbUrl: string;
  pageUrl: string;
  /** Author/creator (plain text, HTML stripped) — required attribution; null when Commons omits it. */
  artist: string | null;
  /** Short licence name, e.g. "CC BY-SA 4.0"; null when unknown. */
  license: string | null;
  /** Link to the licence text; null when unknown. */
  licenseUrl: string | null;
  /** Image coordinates when Commons has them; null otherwise (for a future map-pin feature). */
  lat: number | null;
  lon: number | null;
}

export interface PoiProvider {
  nearbyPhotos(center: LatLon, radiusM: number, limit: number): Promise<Poi[]>;
}

const ENDPOINT = 'https://commons.wikimedia.org/w/api.php';
const MAX_RADIUS_M = 10_000; // Commons ggsradius hard cap
const TTL_MS = 24 * 60 * 60 * 1000;

interface WmExtValue {
  value?: unknown;
}
interface WmImageInfo {
  thumburl?: unknown;
  descriptionurl?: unknown;
  extmetadata?: Record<string, WmExtValue>;
}
interface WmPage {
  title?: unknown;
  coordinates?: Array<{ lat?: unknown; lon?: unknown }>;
  imageinfo?: WmImageInfo[];
}
interface WmResponse {
  query?: { pages?: Record<string, WmPage | null> };
}

function httpsOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.startsWith('https://') ? v : null;
}
/** Commons `Artist`/licence fields are HTML — strip tags to plain text before it reaches the UI. */
function stripHtml(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const text = v
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length ? text.slice(0, 120) : null;
}
function metaStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length ? v.trim().slice(0, 60) : null;
}

/**
 * Parse a Commons geosearch response into POIs. Tolerant: skips null/misshaped pages and keeps only
 * ones with an https thumbnail AND an https file-page link, so no unvalidated/empty URL is rendered.
 */
export function parseWikimediaPois(json: unknown): Poi[] {
  const pages = (json as WmResponse)?.query?.pages;
  if (!pages || typeof pages !== 'object') return [];
  const out: Poi[] = [];
  for (const page of Object.values(pages)) {
    if (!page || typeof page !== 'object') continue;
    const info = page.imageinfo?.[0];
    const thumbUrl = httpsOrNull(info?.thumburl);
    const pageUrl = httpsOrNull(info?.descriptionurl);
    if (!thumbUrl || !pageUrl || typeof page.title !== 'string') continue;
    const ext = info?.extmetadata ?? {};
    const coord = page.coordinates?.[0];
    out.push({
      title: page.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
      thumbUrl,
      pageUrl,
      artist: stripHtml(ext.Artist?.value),
      license: metaStr(ext.LicenseShortName?.value),
      licenseUrl: httpsOrNull(ext.LicenseUrl?.value),
      lat: typeof coord?.lat === 'number' ? coord.lat : null,
      lon: typeof coord?.lon === 'number' ? coord.lon : null,
    });
  }
  return out;
}

export interface WikimediaOptions {
  /** Injectable fetch for fixture-mode tests (defaults to the global, bound to globalThis). */
  fetchFn?: typeof fetch;
  cache?: TtlCache<Poi[]>;
  now?: () => number;
}

export class WikimediaPoiProvider implements PoiProvider {
  private readonly fetchFn: typeof fetch;
  private readonly cache: TtlCache<Poi[]>;
  private readonly now: () => number;

  constructor(opts: WikimediaOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.now = opts.now ?? (() => Date.now());
    this.cache = opts.cache ?? createIdbCache<Poi[]>('windride-poi', 'pois', this.now);
  }

  async nearbyPhotos(center: LatLon, radiusM: number, limit: number): Promise<Poi[]> {
    const radius = Math.min(MAX_RADIUS_M, Math.max(10, Math.round(radiusM)));
    const lim = Math.min(50, Math.max(1, limit));
    const key = `${center.lat.toFixed(3)},${center.lon.toFixed(3)}#${radius}#${lim}`;
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*', // anonymous CORS
      generator: 'geosearch',
      ggscoord: `${center.lat}|${center.lon}`,
      ggsradius: String(radius),
      ggslimit: String(lim),
      ggsnamespace: '6', // File: namespace (images)
      prop: 'imageinfo|coordinates',
      iiprop: 'url|extmetadata',
      iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
      iiurlwidth: '320',
    });
    let res: Response;
    try {
      res = await this.fetchFn(`${ENDPOINT}?${params.toString()}`);
    } catch {
      throw new ProviderError('network', 'Wikimedia request failed');
    }
    if (res.status === 429) throw new ProviderError('quota', 'Wikimedia rate limited');
    if (!res.ok) throw new ProviderError('badResponse', `Wikimedia HTTP ${res.status}`);
    let pois: Poi[];
    try {
      pois = parseWikimediaPois(await res.json());
    } catch {
      throw new ProviderError('badResponse', 'Wikimedia response was not JSON');
    }
    await this.cache.set(key, pois, this.now() + TTL_MS);
    return pois;
  }
}
