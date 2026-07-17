# WR-010 · GPX export + route persistence
Epic: 1 · Planner | Status: TODO | Depends on: WR-009 | Size: S

## Goal
Planned routes survive and travel: save/load routes in idb, export valid GPX 1.1 any bike
computer accepts.

## Context (read first)
ARCHITECTURE §6 · NAVIGATION_SPEC §6 (same GPX writer will serve the recorder).

## Acceptance criteria
- [ ] idb schema v1 (`routes` store) with save/list/delete; Plan screen lists saved routes.
- [ ] `toGpx(route)`: GPX 1.1 `<trk>` with `<ele>`, name, WindRide creator tag; downloads as
      `windride-<date>-<km>km.gpx`.
- [ ] Round-trip test: toGpx → parse back ⇒ identical coordinates/elevation (ε 1e-6).
- [ ] Exported file validates against the GPX 1.1 XSD (dev-time check documented in Log).

## Test contract
Writer unit tests incl. XML escaping of names; schema-migration smoke (open v1 twice).

## Technical notes
Hand-roll the XML (it's ~40 lines) rather than adding a dependency; keep writer in utils/
so nav recorder reuses it.

## Out of scope
FIT format; ride recordings (WR-017).

## Log
