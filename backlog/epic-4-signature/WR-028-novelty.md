# WR-028 · Novelty score — roads you haven't ridden
Epic: 4 · Signature | Status: DONE | Depends on: WR-017 | Size: M

## Goal
Scratch the exploration itch without any social layer: remember every ridden edge locally and
give candidates a small bonus for new roads.

## Context (read first)
ARCHITECTURE §6 riddenEdges · SCORING_SPEC §6 (weights renormalize).

## Acceptance criteria
- [x] Edge encoding: geohash-7 of segment midpoints (documented precision trade-off); on ride
      finish, recorded track's edges merge into idb `riddenEdges` (batch write).
- [x] Novelty sub-score = unridden-length share; joins weights at 0.04 (others renormalized —
      snapshot updated with Log note).
- [x] Results card chip: "38% new roads"; Settings shows total unique km explored + reset.
- [x] Works from recordings only (never planned-but-unridden routes).

## Test contract
Encoding round-trip tests; merge idempotency (re-saving a ride adds nothing); golden fixture
with a pre-seeded ridden set ranks the novel candidate up.

## Technical notes
Geohash-7 ≈ 150 m cells — coarse is fine and privacy-light. Keep the set in memory as a
Set<string> hydrated once.

## Out of scope
Heatmap visualization (fun later); any sharing.

## Log

**2026-07-18** — Shipped the novelty score end to end (ARCHITECTURE §6, SCORING_SPEC §6):
- `src/engine/geohash.ts` (new, pure): `encodeGeohash(lat, lon, precision = 7)` +
  `decodeGeohashCenter` (base-32). Geohash-7 ≈ 153 m cells — the documented precision trade-off:
  privacy-light, GPS-robust, but adjacent lanes within ~150 m merge into one cell.
- `src/engine/novelty.ts` (new, pure): `noveltyShare(analysis, ridden, precision)` = share of
  route *length* whose segment-midpoint cells are NOT in the ridden set (1 = all new — a
  distance/time-honest share, not a segment count). `trackEdges(points)` — the geohash-7 cells a
  recorded ride touched (consecutive-fix midpoints). `uniqueKm(ridden)` ≈
  `size × GEOHASH7_CELL_KM` (0.153). Recordings only.
- `src/engine/scoring.ts`: new `novelty` sub-score = `normalizeHigher(noveltyShare)`; joins
  `DEFAULT_WEIGHTS` at 0.04, other weights renormalized. `ScoreOptions.riddenEdges?:
  ReadonlySet<string>`; `Evidence.noveltyShare` added (the "% new roads" chip source). With an
  empty ridden set every candidate's novelty is 1 ⇒ uniform 0.5 ⇒ no differentiation until a ride
  is recorded — the axis is silently inert for first-time use rather than fabricating signal.
  Golden ranking snapshot re-locked (candidate order A, C, B unchanged; totals renormalized) and
  the WR-025 fragile-demotion snapshot re-locked too, per this story's acceptance note.
- `src/data/db.ts`: idb v3 → v4 adds a `riddenEdges` object store where the edge string itself is
  the key, making merge idempotent by construction; `addRiddenEdges` (batch, one tx),
  `loadRiddenEdges` (hydrate to a `Set`), `clearRiddenEdges`.
- `src/state/noveltyStore.ts` (new): in-memory `Set<string>` mirror of idb, hydrated once.
  `recordRide(points)` merges a finished recording's edges; `reset()` clears; `uniqueKm()`;
  `activeRiddenEdges()` feeds `runPlan` (`baseOpts.riddenEdges`). `RideScreen` records edges on
  finish (recordings only, never planned-but-unridden routes); `PlanScreen` hydrates on mount.
- UI: `RouteCard` chip "38% new roads", shown only when `noveltyShare < 1` — i.e. once there's
  ridden history — avoiding a noisy "100% new" for first-timers with nothing recorded yet.
  `KitScreen` gains "Roads explored" → `NoveltySettings` showing total unique km + a reset.
- Tests: engine `geohash.test.ts` (round-trip within the cell, proximity, invalid char),
  `novelty.test.ts` (length-share not count, all-new/all-ridden, `trackEdges` idempotency,
  `uniqueKm`), a scoring golden (pre-seeded ridden set ranks the novel candidate up; no-history
  produces no differentiation), `db.test.ts` (v4 smoke + `riddenEdges` idempotent merge/hydrate/
  clear, migration adds the store). Full gate: 401 tests, lint clean, build OK.
- See **DEC-032** for the geohash-precision, length-share, idb-key-is-edge, in-memory-mirror,
  uniqueKm-estimate, and empty-history design decisions.
- Reviewed post-implementation by a substitute senior reviewer (Opus) — Fable 5 was out of usage
  credits this session; see follow-up review commit for findings/fixes.
