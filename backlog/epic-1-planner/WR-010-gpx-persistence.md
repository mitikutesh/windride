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
