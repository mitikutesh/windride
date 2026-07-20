# WR-041 · Cross-device sync of non-secret data
Epic: 5 · Accounts | Status: TODO | Depends on: WR-040 | Size: L

## Goal
Signed-in users get their saved routes and preferences on every device — offline-first,
additive, and never touching secrets: the free tier's whole value (DEC-039).

## Context (read first)
DECISIONS DEC-034 (keychain) · DEC-039/DEC-040 (what syncs, what never does) · WR-010/WR-017
idb stores.

## Acceptance criteria
- [ ] Sync scope: saved routes, preferences/settings, optional ride-history METADATA (date,
      distance, duration — not raw GPS traces in v1). **HARD RULE: API keys (`ors` /
      `digitransit` / `ai`) are NEVER synced or sent server-side — browser-only, period
      (DEC-040). A test asserts the sync payload builder excludes the keychain store.**
- [ ] IndexedDB stays primary: the app works fully offline and signed-out; sync is a
      background push/pull that only runs when authenticated.
- [ ] Conflict handling kept simple and documented: per-record last-write-wins on an
      `updatedAt` stamp; deletes are tombstoned so a removal survives a two-device race.
- [ ] Authenticated push/pull Lambdas over the WR-038 single table; payloads validated
      server-side (shape + size caps — a saved route is a polyline + metadata, not a full
      analysis blob).
- [ ] Sync status visible but quiet in the UI: last synced / signed-out / error — never nags.

## Test contract
Store-level unit tests for the merge (LWW both directions, tombstone wins over stale update,
keychain exclusion); api-adapter contract tests against push/pull fixtures (shape, 401,
oversize rejection). No live AWS in tests.

## Technical notes
Wrap the existing idb stores rather than migrating them; the sync layer diffs against a
last-synced cursor. Rides themselves stay local — only their metadata row syncs, and only if
the user opts in.

## Out of scope
Raw ride GPS sync · real-time/multi-writer merging · sharing routes between users.
