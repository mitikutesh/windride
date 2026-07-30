#!/usr/bin/env node
/**
 * tools/fetch_curated_routes.mjs — build public/data/curated-fi.json (WR-052, DEC-060).
 *
 * MANUAL, offline preprocessing — never run in CI (CLAUDE.md rule 3), never called by the app.
 * Users never talk to Bikeland or Overpass: this script ingests both ONCE, normalises them into a
 * compact static catalog that ships with the app artefact on the existing S3+CloudFront deploy
 * (manual dispatch, DEC-056). Refresh = re-run this, commit the JSON, dispatch a deploy (~yearly).
 *
 * Sources
 *   (a) Bikeland — bikeland.fi has NO API, so nothing here scrapes it. Download the GPX files by
 *       hand from the site and drop them in tools/curated_in/ (gitignored). Optional: with the
 *       folder empty the catalog is OSM-only.
 *   (b) OpenStreetMap — ONE polite Overpass query for signed cycle-route relations
 *       (route=bicycle, network=icn/ncn/rcn) inside a Finland bbox. See API_NOTES §7.
 *
 * Usage:
 *   node tools/fetch_curated_routes.mjs                  # both sources (one Overpass query)
 *   node tools/fetch_curated_routes.mjs --cache          # …and keep the raw reply for reuse
 *   node tools/fetch_curated_routes.mjs --from-cache     # rebuild offline from that reply
 *   node tools/fetch_curated_routes.mjs --skip-overpass  # Bikeland GPX only (no network)
 *   CURATED_NETWORKS='icn|ncn' node tools/fetch_curated_routes.mjs   # trim if over budget
 *
 * Use --cache/--from-cache when tuning simplification or filters: re-running the transform must
 * never mean re-hitting a free community endpoint.
 *
 * All transform logic lives in ./curatedCatalog.mjs (pure, unit-tested offline). This file is the
 * I/O shell: read files, one fetch, print the report, write the asset.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, extname, join } from 'node:path';
import {
  ATTRIBUTION,
  MAX_CATALOG_BYTES,
  SIMPLIFY_TOLERANCE_M,
  assertCatalogSize,
  buildCatalog,
  overpassToRoutes,
  parseGpxTracks,
  slug,
} from './curatedCatalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IN_DIR = join(HERE, 'curated_in');
const OUT = join(HERE, '..', 'public', 'data', 'curated-fi.json');

const OVERPASS = process.env.CURATED_OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
// Mainland + archipelago Finland. Override to shrink the result if the budget guard trips.
const BBOX = process.env.CURATED_BBOX || '59.7,19.0,70.1,31.6';
const NETWORKS = process.env.CURATED_NETWORKS || 'icn|ncn|rcn';
// The usage policy asks for an identifiable client on scripted queries (API_NOTES §7).
const USER_AGENT =
  'WindRide/0.7 curated-catalog builder (personal, run manually ~yearly; +https://github.com/mitikutesh/windride)';

const skipOverpass = process.argv.includes('--skip-overpass');
const writeCache = process.argv.includes('--cache');
const fromCache = process.argv.includes('--from-cache');
const CACHE = join(IN_DIR, '.overpass-cache.json'); // inside the gitignored input folder

const query = `[out:json][timeout:600];
relation["route"="bicycle"]["network"~"^(${NETWORKS})$"](${BBOX});
out geom;`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Keep the report readable — the counts are exact, the listing is a sample. */
const preview = (items, n = 8) =>
  items.length <= n
    ? items.join(', ')
    : `${items.slice(0, n).join(', ')} …and ${items.length - n} more`;

/** One retry with backoff — Overpass answers 429/504 when busy; hammering it is not acceptable. */
async function fetchOverpass() {
  if (fromCache) {
    if (!existsSync(CACHE))
      throw new Error(`No cached reply at ${CACHE} — run with --cache first.`);
    console.log(`Overpass: reusing the cached reply at ${CACHE} (no network).`);
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    console.log(`Overpass: querying ${OVERPASS} (attempt ${attempt}/2)…`);
    const res = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'User-Agent': USER_AGENT },
      body: query,
    });
    if (res.ok) {
      const body = await res.text();
      if (writeCache) {
        mkdirSync(IN_DIR, { recursive: true });
        writeFileSync(CACHE, body);
        console.log(`Overpass: cached the raw reply at ${CACHE}`);
      }
      return JSON.parse(body);
    }
    const body = await res.text().catch(() => '');
    if (attempt === 2 || ![429, 502, 503, 504].includes(res.status)) {
      throw new Error(`Overpass ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
    }
    console.warn(`Overpass ${res.status} — backing off 30 s before the single retry.`);
    await sleep(30_000);
  }
  throw new Error('unreachable');
}

function readBikelandGpx() {
  if (!existsSync(IN_DIR)) return [];
  const files = readdirSync(IN_DIR).filter((f) => extname(f).toLowerCase() === '.gpx');
  const routes = [];
  for (const file of files) {
    const xml = readFileSync(join(IN_DIR, file), 'utf8');
    const fallback = basename(file, extname(file)).replace(/[-_]+/g, ' ');
    const tracks = parseGpxTracks(xml, fallback);
    if (tracks.length === 0) {
      console.warn(`  ${file}: no track points found — skipped.`);
      continue;
    }
    tracks.forEach((t, i) => {
      const suffix = tracks.length > 1 ? `-${i + 1}` : '';
      routes.push({
        id: `bikeland-${slug(t.name || fallback)}${suffix}`,
        name: t.name || fallback,
        source: 'bikeland',
        tier: 'curated',
        attribution: ATTRIBUTION.bikeland,
        points: t.points,
      });
    });
    console.log(`  ${file}: ${tracks.length} track(s)`);
  }
  return routes;
}

async function main() {
  console.log(`Bikeland GPX from ${IN_DIR}`);
  const bikeland = readBikelandGpx();
  if (bikeland.length === 0) {
    console.log('  (none — download GPX files from bikeland.fi by hand to include them)');
  }

  let osm = [];
  if (skipOverpass) {
    console.log('Overpass: skipped (--skip-overpass).');
  } else {
    osm = overpassToRoutes(await fetchOverpass());
  }

  const result = buildCatalog([...bikeland, ...osm], {
    generated: new Date().toISOString().slice(0, 10),
  });
  const r = result.report;

  console.log('\n--- curated catalog ---------------------------------------------');
  console.log(`  bikeland routes : ${r.bySource.bikeland ?? 0}`);
  console.log(`  osm routes      : ${r.bySource.osm ?? 0}`);
  console.log(`  total           : ${r.total}  (longest ${r.longestKm} km)`);
  console.log(`  simplify        : ${SIMPLIFY_TOLERANCE_M} m tolerance, endpoints exact`);
  if (r.fragmentsDropped) {
    console.log(`  gap fragments   : ${r.fragmentsDropped} shorter chain(s) not used`);
  }
  if (r.partial) {
    console.log(`  partial routes  : ${r.partial} flagged "longest mapped section" in the UI`);
  }
  if (r.skippedShort.length) {
    console.log(`  under min length: ${r.skippedShort.length} → ${preview(r.skippedShort)}`);
  }
  if (r.skippedEmpty.length) {
    console.log(`  no geometry     : ${r.skippedEmpty.length} → ${preview(r.skippedEmpty)}`);
  }
  console.log(
    `  size            : ${(r.bytes / 1e6).toFixed(2)} MB of ${(MAX_CATALOG_BYTES / 1e6).toFixed(2)} MB budget`,
  );
  console.log('-----------------------------------------------------------------\n');

  assertCatalogSize(result); // over budget => throw; we never trim to fit
  writeFileSync(OUT, result.json + '\n');
  console.log(`Wrote ${r.total} curated routes to ${OUT}`);
  console.log('Commit the JSON, then deploy via Actions → "Deploy to AWS" (manual, DEC-056).');
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
