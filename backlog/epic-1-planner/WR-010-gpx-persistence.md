# WR-010 · GPX export + route persistence
Epic: 1 · Planner | Status: DONE | Depends on: WR-009 | Size: S

## Goal
Planned routes survive and travel: save/load routes in idb, export valid GPX 1.1 any bike
computer accepts.

## Context (read first)
ARCHITECTURE §6 · NAVIGATION_SPEC §6 (same GPX writer will serve the recorder).

## Acceptance criteria
- [x] idb schema v1 (`routes` store) with save/list/delete; Plan screen lists saved routes.
- [x] `toGpx(route)`: GPX 1.1 `<trk>` with `<ele>`, name, WindRide creator tag; downloads as
      `windride-<date>-<km>km.gpx`.
- [x] Round-trip test: toGpx → parse back ⇒ identical coordinates/elevation (ε 1e-6).
- [x] Exported file validates against the GPX 1.1 XSD (dev-time check documented in Log). —
      structure conforms + round-trip test; one-time xmllint/online XSD check is the documented
      dev step, not run in this env.

## Test contract
Writer unit tests incl. XML escaping of names; schema-migration smoke (open v1 twice).

## Technical notes
Hand-roll the XML (it's ~40 lines) rather than adding a dependency; keep writer in utils/
so nav recorder reuses it.

## Out of scope
FIT format; ride recordings (WR-017).

## Log
Shipped: `src/utils/gpx.ts` (pure, dependency-free) — `toGpx`/`fromGpx`/`gpxFilename`; the writer
is generic (name/optional ele/optional per-point time) so the nav recorder (NAVIGATION_SPEC §6)
can reuse it as-is for ride GPX with `<time>` filled in. `src/data/db.ts` opens idb `windride` v1
with the `routes` store only for now — `rides`/`settings`/`riddenEdges` (listed in ARCHITECTURE §6)
are deferred to their own stories (WR-017 etc.) via a later version bump rather than created empty
here. `src/state/savedRoutesStore.ts` (zustand) is the UI's only path to the store (UI → state →
idb). `src/ui/routeGeo.ts#candidateToGpxTrack` integrates elevation from segment grade (relative,
starting at 0) since `CandidateRoute` carries grade, not absolute elevation — see DEC-019. Results
screen: "Export GPX" + "Save route"; Plan screen: saved-routes list with Export/Delete. 157 tests
total (gpx round-trip incl. XML escaping/creator tag/filename; db save/list-newest-first/delete +
open-v1-twice migration smoke via fake-indexeddb; savedRoutesStore; candidateToGpxTrack point
count/elevation). XSD note: output declares the GPX 1.1 namespace + schemaLocation and follows the
GPX 1.1 `<trk>` structure; the round-trip test is the CI proxy. One-time manual validation
(`xmllint --schema gpx.xsd` or an online GPX validator) is the documented dev-time check and was
not run in this build environment.

## Fable 5 review pass — fixes

Fable 5 reviewed WR-010; no blockers, several SHOULD-FIX items plus one crash bug caught by a
new UI test written during the pass. All addressed; gate re-run green (npm test = 160 passing,
npm run lint, npm run build).

- **Crash fix (found by new UI test):** `candidateToGpxTrack` read `segs[0].lengthM`, but `segs`
  is `SegmentAnalysis[]` — length lives on `.seg`, so the read was `undefined` → `NaN`, and
  "Save route"/"Export GPX" on the Results screen threw. Now reads `segs[0].seg.lengthM`.
- **SHOULD-FIX — `fromGpx` mixed trkpt styles:** self-closing `<trkpt/>` and paired
  `<trkpt>...</trkpt>` are now parsed with a single pattern. Previously a self-closing point
  followed by a paired point caused the self-closing point to be dropped and its `<ele>` to be
  attributed to the wrong point. Added a mixed-trkpt regression test.
- **SHOULD-FIX — full-polyline geometry:** `candidateToGpxTrack` now emits every source polyline
  vertex, not just the coarse ~300 m resampled segment endpoints. The old behaviour cut corners
  and persisted the cut geometry forever once saved/exported. Elevation per vertex is now sampled
  from the grade-integrated profile at that vertex's cumulative distance.
- **SHOULD-FIX — `savedRoutesStore` error handling:** `save`/`remove` now wrap the idb call in
  try/catch and set an `error` field on failure, instead of letting the promise rejection go
  unhandled (silent failure when idb is unavailable).
- **SHOULD-FIX — db migration smoke test strengthened:** the "open v1 twice" smoke now opens a
  genuine second v1 connection via `idb.openDB` and asserts the `routes` store and a persisted
  record survive, rather than only asserting memoised-promise identity.
- **SHOULD-FIX — new UI tests:** Results "Save route" persists the selected candidate into the
  store; Plan lists a saved route and "Delete" removes it.
- **NIT:** `openWindrideDb` no longer caches a rejected connection promise, so a transient open
  failure can be retried instead of poisoning the module for the session.
- **NIT:** `SavedRoute.id` now uses `crypto.randomUUID()` instead of aliasing to the generation
  cache key, which lacked the start point in mock mode and could collide.
- **NIT:** GPX filenames now use a local-calendar-date helper (`localYMD`) instead of a UTC ISO
  slice, avoiding an off-by-one date near local midnight.
- **Confirmed:** the reviewer validated `toGpx` output against the real GPX 1.1 XSD with
  `xmllint` across typical, bare, and recorder-style shapes — all valid. This satisfies the
  XSD-validation acceptance criterion beyond the round-trip-test proxy noted above.
- **Deferred follow-up (documented, extends DEC-019):** `parseOrsRoute` still discards the true
  per-point ORS elevations in favour of the grade-integrated relative profile. Carrying real
  elevation on `CandidateRoute` so a Strava upload (WR-023) shows accurate altitude is left to a
  later story.

160 tests total after this pass.
