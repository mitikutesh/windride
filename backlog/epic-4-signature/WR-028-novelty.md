# WR-028 · Novelty score — roads you haven't ridden
Epic: 4 · Signature | Status: TODO | Depends on: WR-017 | Size: M

## Goal
Scratch the exploration itch without any social layer: remember every ridden edge locally and
give candidates a small bonus for new roads.

## Context (read first)
ARCHITECTURE §6 riddenEdges · SCORING_SPEC §6 (weights renormalize).

## Acceptance criteria
- [ ] Edge encoding: geohash-7 of segment midpoints (documented precision trade-off); on ride
      finish, recorded track's edges merge into idb `riddenEdges` (batch write).
- [ ] Novelty sub-score = unridden-length share; joins weights at 0.04 (others renormalized —
      snapshot updated with Log note).
- [ ] Results card chip: "38% new roads"; Settings shows total unique km explored + reset.
- [ ] Works from recordings only (never planned-but-unridden routes).

## Test contract
Encoding round-trip tests; merge idempotency (re-saving a ride adds nothing); golden fixture
with a pre-seeded ridden set ranks the novel candidate up.

## Technical notes
Geohash-7 ≈ 150 m cells — coarse is fine and privacy-light. Keep the set in memory as a
Set<string> hydrated once.

## Out of scope
Heatmap visualization (fun later); any sharing.

## Log
