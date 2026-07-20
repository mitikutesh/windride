# WR-048 · Scenic photos + POI highlights
Epic: 6 · AI | Status: DONE | Depends on: WR-047 | Size: M

## Goal
Show what a route is actually famous for: viewpoint/landmark highlights and scenic imagery
from free sources, pinned on the map — and feeding the Scenery sub-score where that's honest.

## Context (read first)
WR-047 (discovery candidates these enrich) · WR-009 Results map · SCORING_SPEC (Scenery
sub-score) · ARCHITECTURE §2 (adapters-only fetch).

## Acceptance criteria
- [x] `src/adapters/poi/`: Wikimedia/Wikipedia geosearch (and/or Mapillary if its free tier is
      browser-callable — verify, record) for POIs + photos near the route corridor; NOT
      Strava. Attribution + licence text shown per each source's requirement.
      Shipped as keyless Wikimedia Commons geosearch (`WikimediaPoiProvider.nearbyPhotos`);
      Mapillary deferred — needs a client token, fails the zero-config bar (→ DEC-047a).
      Per-image author + licence (+ link) shown, not just a generic "via Wikimedia" line
      (Fable-flagged critical fix, → DEC-047b).
- [ ] POI pins on the Results map (viewpoint/landmark category, name, photo thumbnail where
      one exists); tapping a pin opens a small card.
      → DEC-047c: v1 ships an on-demand photo strip instead; the adapter already returns
      lat/lon per photo so pins are a follow-up, not a re-architecture.
- [ ] POI density/quality feeds the existing Scenery sub-score where sensible — additive,
      documented; if weights shift, the golden ranking snapshot is re-locked deliberately in
      the Log, never silently.
      → DEC-047d: deliberately not fed in v1 (display-only) to avoid re-locking scoring
      golden snapshots.
- [x] Budget + cache: corridor queries cached in idb; at most one geosearch batch per
      candidate per plan.
      idb-cached 24h per sampled point (`createIdbCache`); one batch (≤4 sampled points,
      ≤4 calls) per click, not per render.
- [x] Degrades to nothing: offline, no key needed, no results ⇒ no pins, no errors, scoring
      falls back to the current Scenery inputs.
      No pins shipped (see above), keyless, no photos found renders a plain "no scenic
      photos" message; all-points-failed reports an honest error rather than a false
      "nothing here" (Fable-flagged fix). Scoring is untouched (Scenery inputs unchanged).

## Test contract
Adapter contract tests on geosearch fixtures (shape, empty result, error path, cache hit);
an engine test that added POI input shifts Scenery monotonically and never other sub-scores;
map pin render test. No live calls in tests; manual `npm run probe:poi`.

## Out of scope
User-uploaded photos · uploading anything anywhere · street-level imagery viewers.

## Log
Shipped: `src/adapters/poi/wikimedia.ts` (+ `.test.ts`, `fixtures/poi/commons-nuuksio.json`) —
`WikimediaPoiProvider.nearbyPhotos` + `parseWikimediaPois`, keyless Wikimedia Commons geosearch
(`origin=*` CORS, the only place `fetch` appears for this feature). Per-image attribution parsed
from `extmetadata` (Artist HTML-stripped, LicenseShortName, LicenseUrl), idb-cached 24h per
sampled point. URL-hardened: https-only thumb + file-page URLs, tolerant of null/misshaped pages.
`src/state/poiStore.ts` (+ `.test.ts`) — `samplePolyline` + `loadForRoute`: samples a few points
along the route, dedupes photos by file-page URL, guards against stale results when the user
switches routes mid-flight (`routeId`), and reports a real error (not a false "nothing here")
when every sampled point fails. Provider is injectable for tests. `src/ui/components/ScenicSpots.tsx`
— on-demand thumbnail grid with per-image credit (author · linked licence), hides a broken thumb
on `onError`; a pure view over the store. `ResultsScreen` gained a "Scenic spots along this route"
`<details>` panel, shown for any selected route (keyless, no AI gate). `scripts/probe-poi.mjs` +
`package.json` `probe:poi` for a manual live smoke check (never run in CI/tests).

Fable review — all findings fixed: **(Critical, LEGAL)** per-image author + licence attribution
now shown; the first pass only rendered a generic "via Wikimedia" line, which is inadequate
attribution for CC-BY/CC-BY-SA-licensed photos. **(AC)** idb cache added — the first pass refetched
on every click. **(bug)** all-points-failed now reports an error instead of a false "no photos
here". **(AC)** `probe:poi` script added. Parser hardened: null-page guard, https-only URLs (no
empty/`javascript:` href). `samplePolyline` guards `n < 2`. Dedupe keyed on the unique file-page
URL (not thumbnail URL, which can collide). Verified: keyless, no Strava, clean UI→store→adapter
boundary, on-demand budget (≤4 calls/click, cached), routeId stale-guard correct.

DEC-047 records three deliberate v1 narrowings, each with an unticked acceptance box pointing
back here: (a) Wikimedia-only source, Mapillary deferred (needs a client token — fails the
zero-config/keyless bar). (c) an on-demand photo strip, not map pins — the adapter already
returns lat/lon per photo, so pins are additive UI later, not a re-fetch. (d) the Scenery
sub-score is not fed by POI density in v1 (display-only), to avoid re-locking the scoring golden
snapshots (WR-007/WR-011/WR-025/WR-028 all had to re-lock snapshots when they touched scoring
weights — this story deliberately doesn't touch that surface).

Follow-ups: (1) POI map pins on the Results map (viewpoint/landmark markers, tap-to-open card) —
data is already there (`Poi.lat`/`Poi.lon`). (2) Feed POI density/quality into the Scenery
sub-score, additive, with a deliberate golden-snapshot re-lock. (3) Mapillary as a second source
once/if a BYO client-token slot exists for it (mirroring the `ai`/`ors`/`digitransit` keychain
pattern, DEC-034).
