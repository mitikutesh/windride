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

**2026-07-18 — Substitute review (Opus, standing in for Fable 5 — out of credits) — fixes
applied.** Verdict: SHIP-ABLE, no blockers/majors — 2 MINOR + 2 NITs; fixes applied, gate green
(402 tests, lint clean, build OK).
- **MINOR-1 — crash-recovery path skipped novelty.** The crash-recovery "Save it" flow
  (`saveUnfinished`) never recorded ridden edges — it destructured only `{ gpx, summary }` from
  `saveUnfinishedRide`, dropping the points. Fixed: it now also pulls `points` (already returned
  by `saveUnfinishedRide`) and calls `noveltyStore.recordRide(points)` — a crash-recovered ride is
  still a real recording and should count.
- **MINOR-2 — no test proved the record↔score geohash contract.** The candidate side geohashes
  *segment midpoints*; the ride side geohashes *consecutive-fix midpoints* — different
  conventions that were never cross-checked. Fixed: added a `novelty.test.ts` case that traces a
  candidate's line with dense fixes through `trackEdges` and asserts
  `noveltyShare(candidate, thoseEdges) < 0.1` — a route you literally rode reads as ridden.
- **NIT — chip could over-claim.** The "% new roads" chip used `Math.round`, so a 99.6% share
  displayed "100%" (indistinguishable from a truly all-new route, which hides the chip entirely
  at `share === 1`). Fixed: it now uses `Math.floor` so the displayed number never claims more
  novelty than there is.
- **NIT (noted, not changed) — `uniqueKm` leans high at 60°N.** Geohash-7 cells narrow in the
  east-west direction at high latitude (~76 m E-W at 60°N vs. ~153 m N-S), so `uniqueKm` slightly
  overestimates. Left as-is: the UI already labels it "≈ … km unique," an honest estimate, not a
  precise figure.
- The reviewer also independently verified, with no findings: the geohash encoder is canonical
  (no lat/lon swap), the golden test genuinely isolates novelty rather than confounding it with
  another axis, the idb v4 store is idempotent with no migration data loss, and the in-memory
  ridden-edges set is copied (never mutated) under a running score.
