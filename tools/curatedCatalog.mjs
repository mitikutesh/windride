/**
 * tools/curatedCatalog.mjs — the PURE transform core behind `fetch_curated_routes.mjs` (WR-052).
 *
 * No I/O, no clock, no network: raw source text/JSON in, catalog object out. That is what makes it
 * unit-testable offline (`tools/curatedCatalog.test.mjs`, fixtures only — CLAUDE.md rule 3) while
 * the sibling runner keeps every file read, fetch and write.
 *
 * Plain ESM (not TypeScript) so `node tools/fetch_curated_routes.mjs` runs with no build step, the
 * same way `fetch_stations.mjs` does.
 */
import { lineString, simplify } from '@turf/turf';

/** Catalog schema version — bump whenever an entry field changes shape (the adapter checks it). */
export const CATALOG_VERSION = 1;

/** Douglas–Peucker tolerance in METRES (DEC-060). Endpoints are always kept exact. */
export const SIMPLIFY_TOLERANCE_M = 15;

/** Raw-JSON budget for public/data/curated-fi.json (DEC-060). Exceeding it FAILS, never trims. */
export const MAX_CATALOG_BYTES = 1_500_000;

/** Shorter than this isn't a day ride worth catalogue space; reported, never silently dropped. */
export const MIN_LENGTH_KM = 5;

/** A closed loop when the two ends are this close (Bikeland loops rarely close to the metre). */
export const LOOP_CLOSE_M = 500;

/** Gap under which two relation member ways still count as one continuous route. */
export const STITCH_GAP_M = 100;

/**
 * Below this share of a relation's mapped length, the chain we keep is only PART of the signed
 * route and the entry is flagged `partial` — so the UI can say "longest mapped section" instead of
 * presenting a 43 km fragment under the name and promise of a 120 km signed route.
 */
export const PARTIAL_BELOW_SHARE = 0.9;

export const ATTRIBUTION = {
  osm: '© OpenStreetMap contributors (ODbL)',
  bikeland: 'Route data © Bikeland (bikeland.fi)',
};

const EARTH_R = 6371008.8;
const M_PER_DEG_LAT = 110574;

const deg2rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres (same formula as src/engine/geometry.haversineM). */
export function haversineM(a, b) {
  const dLat = deg2rad(b.lat - a.lat);
  const dLon = deg2rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(a.lat)) * Math.cos(deg2rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function polylineLengthM(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i]);
  return total;
}

export function bboxOf(points) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return {
    minLat: Math.min(...lats),
    minLon: Math.min(...lons),
    maxLat: Math.max(...lats),
    maxLon: Math.max(...lons),
  };
}

export function slug(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

// --- simplification ---------------------------------------------------------------------------

/**
 * Douglas–Peucker in METRES. turf's `simplify` tolerance is expressed in the units of the input
 * coordinates, so feeding it lat/lon degrees would mean a tolerance ~2× looser east-west than
 * north-south at Finnish latitudes. We therefore project to a local equirectangular metre grid
 * first, simplify there, and map the survivors back to the ORIGINAL lat/lon by index — so no
 * coordinate is ever re-projected back (no round-trip error) and first/last stay exact.
 */
export function simplifyPoints(points, toleranceM = SIMPLIFY_TOLERANCE_M) {
  if (points.length < 3) return points.slice();
  const meanLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const kx = M_PER_DEG_LAT * Math.cos(deg2rad(meanLat));
  const coords = points.map((p) => [p.lon * kx, p.lat * M_PER_DEG_LAT]);
  const kept = simplify(lineString(coords), { tolerance: toleranceM, highQuality: true }).geometry
    .coordinates;

  // Walk forward: `kept` is an in-order subsequence of `coords`, so a single pointer is enough.
  const out = [];
  let i = 0;
  for (const c of kept) {
    while (i < coords.length && (coords[i][0] !== c[0] || coords[i][1] !== c[1])) i++;
    if (i >= coords.length) break;
    out.push(points[i]);
    i++;
  }
  // Endpoints are kept exact even if a degenerate input confused the walk above.
  if (out.length < 2) return [points[0], points[points.length - 1]];
  out[0] = points[0];
  out[out.length - 1] = points[points.length - 1];
  return out;
}

/** Round to ~1.1 m (5 dp) and drop points that collapse onto their predecessor. */
export function roundPoints(points, dp = 5) {
  const f = 10 ** dp;
  const out = [];
  for (const p of points) {
    const q = { lat: Math.round(p.lat * f) / f, lon: Math.round(p.lon * f) / f };
    const prev = out[out.length - 1];
    if (prev && prev.lat === q.lat && prev.lon === q.lon) continue;
    out.push(q);
  }
  return out;
}

// --- GPX (Bikeland) ---------------------------------------------------------------------------

const XML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function unescapeXml(s) {
  return s.replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m]);
}

function attrNum(attrs, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

function pointsFromGpxBlock(block) {
  const out = [];
  const re = /<(?:trkpt|rtept)\b([^>]*?)\/?>/gi;
  let m;
  while ((m = re.exec(block)) !== null) {
    const lat = attrNum(m[1], 'lat');
    const lon = attrNum(m[1], 'lon');
    if (lat === null || lon === null) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({ lat, lon });
  }
  return out;
}

function firstName(block) {
  const m = /<name\b[^>]*>([\s\S]*?)<\/name>/i.exec(block);
  return m ? unescapeXml(m[1]).trim() : '';
}

/**
 * Parse a Bikeland GPX export into named tracks. Deliberately regex-based (no XML dependency):
 * GPX track points are flat attributes and these files are hand-downloaded, not adversarial input.
 * `<trk>` blocks win; a route-only (`<rte>`) file falls back to the whole document as one track.
 */
export function parseGpxTracks(xml, fallbackName = 'Route') {
  const docName = firstName(/<metadata\b[\s\S]*?<\/metadata>/i.exec(xml)?.[0] ?? '');
  const tracks = [];
  const trkRe = /<trk\b[\s\S]*?<\/trk>/gi;
  let m;
  while ((m = trkRe.exec(xml)) !== null) {
    const points = pointsFromGpxBlock(m[0]);
    if (points.length < 2) continue;
    tracks.push({ name: firstName(m[0]) || docName || fallbackName, points });
  }
  if (tracks.length === 0) {
    const points = pointsFromGpxBlock(xml);
    if (points.length >= 2) tracks.push({ name: docName || fallbackName, points });
  }
  return tracks;
}

// --- Overpass (OSM signed cycle-route relations) ----------------------------------------------

const TIERS = ['icn', 'ncn', 'rcn'];

/** `network` can carry several tokens ("ncn;rcn") — the most national one wins for display. */
export function tierFromNetwork(network) {
  if (typeof network !== 'string') return 'curated';
  const tokens = network.toLowerCase().split(/[;,\s]+/);
  for (const t of TIERS) if (tokens.includes(t)) return t;
  return 'curated';
}

/**
 * Chain relation member ways into continuous lines. Members arrive in relation order but each way
 * may be stored in either direction, so both ends of the growing chain are candidates for the next
 * member. Gaps up to `gapToleranceM` are bridged (junction//survey noise); anything larger starts a
 * NEW chain rather than drawing a fake straight line across a real gap.
 */
export function stitchWays(ways, gapToleranceM = STITCH_GAP_M) {
  const pool = ways.filter((w) => Array.isArray(w) && w.length >= 2).map((w) => w.slice());
  const chains = [];
  while (pool.length > 0) {
    let chain = pool.shift();
    for (;;) {
      let best = null;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        const head = chain[0];
        const tail = chain[chain.length - 1];
        const options = [
          { d: haversineM(tail, w[0]), i, at: 'end', flip: false },
          { d: haversineM(tail, w[w.length - 1]), i, at: 'end', flip: true },
          { d: haversineM(head, w[w.length - 1]), i, at: 'start', flip: false },
          { d: haversineM(head, w[0]), i, at: 'start', flip: true },
        ];
        for (const o of options) {
          if (o.d <= gapToleranceM && (best === null || o.d < best.d)) best = o;
        }
      }
      if (best === null) break;
      const [way] = pool.splice(best.i, 1);
      const seq = best.flip ? way.slice().reverse() : way;
      if (best.at === 'end') {
        const skip = haversineM(chain[chain.length - 1], seq[0]) < 1 ? 1 : 0;
        chain = chain.concat(seq.slice(skip));
      } else {
        const drop = haversineM(seq[seq.length - 1], chain[0]) < 1 ? 1 : 0;
        chain = seq.slice(0, seq.length - drop).concat(chain);
      }
    }
    chains.push(chain);
  }
  return chains;
}

/**
 * Overpass `out geom` response → one raw route per relation, using the LONGEST continuous chain of
 * its member ways. Signed networks routinely include alternative/excursion spurs and genuinely
 * disjoint legs; taking the longest chain keeps the geometry honest (no invented connections) and
 * the dropped remainder is reported by the caller, never hidden.
 */
export function overpassToRoutes(json, opts = {}) {
  const gap = opts.gapToleranceM ?? STITCH_GAP_M;
  const elements = Array.isArray(json?.elements) ? json.elements : [];
  const routes = [];
  for (const el of elements) {
    if (el?.type !== 'relation' || !Array.isArray(el.members)) continue;
    const tags = el.tags ?? {};
    const ways = el.members
      .filter((mb) => mb?.type === 'way' && Array.isArray(mb.geometry) && mb.geometry.length >= 2)
      .filter((mb) => !['alternative', 'excursion'].includes(String(mb.role ?? '')))
      .map((mb) =>
        mb.geometry
          .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
          .map((p) => ({ lat: p.lat, lon: p.lon })),
      );
    const chains = stitchWays(ways, gap).sort((a, b) => polylineLengthM(b) - polylineLengthM(a));
    const longest = chains[0];
    if (!longest || longest.length < 2) continue;
    const mappedM = chains.reduce((sum, c) => sum + polylineLengthM(c), 0);
    const retainedShare = mappedM > 0 ? polylineLengthM(longest) / mappedM : 1;
    const name = String(tags.name || tags['name:fi'] || tags.ref || `Cycle route ${el.id}`).trim();
    routes.push({
      id: `osm-r-${el.id}`,
      name,
      source: 'osm',
      tier: tierFromNetwork(tags.network),
      attribution: ATTRIBUTION.osm,
      points: longest,
      fragmentsDropped: chains.length - 1,
      retainedShare,
    });
  }
  return routes;
}

// --- catalog assembly -------------------------------------------------------------------------

function toEntry(raw, toleranceM) {
  const points = roundPoints(simplifyPoints(raw.points, toleranceM));
  if (points.length < 2) return null;
  const lengthM = polylineLengthM(points);
  const ends = haversineM(points[0], points[points.length - 1]);
  return {
    id: raw.id,
    name: raw.name,
    source: raw.source,
    tier: raw.tier,
    kind: ends <= LOOP_CLOSE_M ? 'loop' : 'linear',
    // Length comes from the SIMPLIFIED geometry so the catalog's km, the map, and the engine's
    // distance/ETA all describe the same line — never the pre-simplification original.
    lengthKm: Math.round((lengthM / 1000) * 10) / 10,
    bbox: bboxOf(points),
    attribution: raw.attribution,
    // Only present when true, so the common case costs no bytes.
    ...((raw.retainedShare ?? 1) < PARTIAL_BELOW_SHARE ? { partial: true } : {}),
    points: points.map((p) => [p.lat, p.lon]),
  };
}

/**
 * Build the catalog object + its serialised bytes from already-parsed raw routes.
 *
 * Pure: `generated` is passed in (no clock here) and nothing is written or printed. The size budget
 * is REPORTED, not enforced — call `assertCatalogSize` to fail the run, so the caller always gets
 * the counts to print first (a silent trim to fit is exactly what WR-052 forbids).
 */
export function buildCatalog(rawRoutes, opts = {}) {
  const toleranceM = opts.toleranceM ?? SIMPLIFY_TOLERANCE_M;
  const maxBytes = opts.maxBytes ?? MAX_CATALOG_BYTES;
  const minLengthKm = opts.minLengthKm ?? MIN_LENGTH_KM;

  const skippedShort = [];
  const skippedEmpty = [];
  const byId = new Map();
  let fragmentsDropped = 0;

  for (const raw of rawRoutes) {
    const entry = toEntry(raw, toleranceM);
    if (!entry) {
      skippedEmpty.push(raw.id);
      continue;
    }
    if (entry.lengthKm < minLengthKm) {
      skippedShort.push(`${entry.id} (${entry.lengthKm} km)`);
      continue;
    }
    fragmentsDropped += raw.fragmentsDropped ?? 0;
    // Keep-first on duplicate ids (a relation present in two source files stays one entry).
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }

  const routes = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const bySource = {};
  for (const r of routes) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  const attributions = [...new Set(routes.map((r) => r.attribution))].sort();
  const catalog = {
    version: CATALOG_VERSION,
    generated: opts.generated ?? '',
    attributions,
    routes,
  };
  const json = JSON.stringify(catalog);
  const bytes = Buffer.byteLength(json, 'utf8');

  return {
    catalog,
    json,
    bytes,
    report: {
      bySource,
      total: routes.length,
      skippedShort,
      skippedEmpty,
      fragmentsDropped,
      partial: routes.filter((r) => r.partial).length,
      bytes,
      maxBytes,
      withinBudget: bytes <= maxBytes,
      longestKm: routes.reduce((m, r) => Math.max(m, r.lengthKm), 0),
    },
  };
}

/** Fail the run loudly when the catalog blows the budget. Never trims to fit (WR-052). */
export function assertCatalogSize(result) {
  const { bytes, maxBytes, total } = result.report;
  if (bytes <= maxBytes) return;
  throw new Error(
    `curated catalog is ${(bytes / 1e6).toFixed(2)} MB — over the ${(maxBytes / 1e6).toFixed(2)} MB budget ` +
      `for ${total} routes. Raise the simplify tolerance, narrow the bbox, or drop a tier — ` +
      `routes are never silently dropped to fit.`,
  );
}
