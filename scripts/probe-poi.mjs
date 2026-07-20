#!/usr/bin/env node
/**
 * Manual live smoke check for the Wikimedia Commons POI adapter (WR-048). NEVER runs in CI.
 *
 *   node scripts/probe-poi.mjs [lat] [lon]
 *
 * Keyless + CORS-open, so no env is required. Confirms the geosearch endpoint is reachable and the
 * response shape (imageinfo + extmetadata for attribution) matches parseWikimediaPois. Makes one
 * call. Defaults to central Espoo.
 */
const lat = Number(process.argv[2] ?? 60.17);
const lon = Number(process.argv[3] ?? 24.65);

const params = new URLSearchParams({
  action: 'query',
  format: 'json',
  origin: '*',
  generator: 'geosearch',
  ggscoord: `${lat}|${lon}`,
  ggsradius: '2000',
  ggslimit: '5',
  ggsnamespace: '6',
  prop: 'imageinfo|coordinates',
  iiprop: 'url|extmetadata',
  iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
  iiurlwidth: '320',
});

const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`);
if (!res.ok) {
  console.error(`Probe failed: HTTP ${res.status}`);
  process.exit(1);
}
const json = await res.json();
const pages = Object.values(json?.query?.pages ?? {});
console.log(`Found ${pages.length} nearby image page(s) at ${lat}, ${lon}:`);
for (const p of pages) {
  const info = p.imageinfo?.[0];
  const artist = (info?.extmetadata?.Artist?.value ?? '').replace(/<[^>]*>/g, '').trim();
  const lic = info?.extmetadata?.LicenseShortName?.value ?? '(no licence field)';
  console.log(
    `  • ${p.title} — ${artist || 'unknown'} · ${lic} — ${info?.thumburl ? 'thumb ok' : 'NO THUMB'}`,
  );
}
