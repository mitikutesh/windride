# WR-041 · Cross-device sync of non-secret data
Epic: 5 · Accounts | Status: DONE | Depends on: WR-040 | Size: L

## Goal
Signed-in users get their saved routes and preferences on every device — offline-first,
additive, and never touching secrets: the free tier's whole value (DEC-039).

## Context (read first)
DECISIONS DEC-034 (keychain) · DEC-039/DEC-040 (what syncs, what never does) · WR-010/WR-017
idb stores.

## Acceptance criteria
- [x] Sync scope: saved routes, preferences/settings, optional ride-history METADATA (date,
      distance, duration — not raw GPS traces in v1). **HARD RULE: API keys (`ors` /
      `digitransit` / `ai`) are NEVER synced or sent server-side — browser-only, period
      (DEC-040). A test asserts the sync payload builder excludes the keychain store.**
      Shipped: saved routes (field-picked) + 5 named prefs sync; keys structurally can't be
      included (`buildSyncDoc` allow-list, `syncDoc.test.ts`). Ride-history metadata sync is
      DEFERRED — DEC-052(c).
- [x] IndexedDB stays primary: the app works fully offline and signed-out; sync is a
      background push/pull that only runs when authenticated.
- [x] Conflict handling kept simple and documented: per-record last-write-wins on an
      `updatedAt` stamp; deletes are tombstoned so a removal survives a two-device race.
      Shipped: additive union of saved routes by id + deletion tombstones (a newer re-save
      supersedes a tombstone); malformed remote entries are dropped. Full per-field record LWW
      and applying remote prefs are narrowed for v1 — DEC-052(a)/(b).
- [x] Authenticated push/pull Lambdas over the WR-038 single table; payloads validated
      server-side (shape + size caps — a saved route is a polyline + metadata, not a full
      analysis blob).
      Shipped: `GET`/`PUT /sync` (Bearer id token), one SYNC item per user partition; PUT
      rejects a non-object/array doc (400) and an over-256KB doc (413) — never a 500.
- [x] Sync status visible but quiet in the UI: last synced / signed-out / error — never nags.
      Shipped: opt-in "Sync saved routes now" button on `AuthPanel` with a quiet
      Syncing…/Synced./error line; no auto-nag.

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

## Log
Shipped cross-device sync of non-secret data, keys never sync:
- `src/state/sync/syncDoc.ts` (+test): `buildSyncDoc` (allow-list: field-picked saved routes +
  5 named prefs — keys structurally can't be included), `mergeSyncDocs` (union routes by id,
  tombstone-aware so deletes survive + a newer re-save wins, drops malformed remote entries),
  `isSavedRoute`/`isSyncDoc` guards, tombstones carried in the doc.
- `src/data/db.ts`: route tombstone helpers (`getRouteTombstones`/`addRouteTombstone`/
  `setRouteTombstones`) in the CONFIG store. `src/state/savedRoutesStore.ts`: `remove()` now
  tombstones the deletion.
- `src/state/syncStore.ts` (+test): `syncNow` pulls → merges → applies to idb (adds pulled
  routes, deletes tombstoned ones) → pushes; reads local state from idb directly (not the
  unhydrated store mirror) so a sync triggered from Kit uploads everything; offline-first
  (apply happens before push, so a failed push never loses local data); fully injectable for
  tests.
- `src/adapters/api/{types,client}.ts` (+test): `getSync`/`putSync` (Bearer id token,
  `{ doc }` envelope).
- `infra/lambda/index.mjs` (+`infra/test/api-routes.test.ts`): authenticated `GET`/`PUT /sync`;
  `PUT` rejects a non-object/array doc (400) and an over-256KB doc (413) — never a 500.
  `infra/lambda/store.mjs`: `getSyncDoc`/`putSyncDoc` (one SYNC item per user partition).
- `src/ui/components/AuthPanel.tsx`: "Sync saved routes now" button + quiet status line
  (opt-in, shown only when the backend is configured).

**Fable review:** keyless guarantee CONFIRMED — no code path from the API keychain into the
sync doc; the guarding test contaminates both the prefs object and a route object to prove
the allow-list holds. No destructive path found. Fixes applied from the review:
1. (Critical) **Delete-resurrection** — added tombstones so a removal on one device propagates
   and a pulled copy from another device can't resurrect the route.
2. (Important) **Under-sync** — `syncNow` now reads saved routes from idb directly instead of
   the zustand mirror, so a sync triggered from Kit (before `PlanScreen` mounts) uploads every
   saved route, not just whatever happened to be hydrated.
3. (Important) **Server-side validation gaps** — added the 413 size cap and 400 rejection of a
   non-object/array doc, so a bad or oversized `PUT` never 500s.
4. (Important) **Field-pick + per-entry validation** — routes are field-picked on both build and
   merge, and each remote entry is validated (`isSavedRoute`) before being trusted, so no junk
   or extra field can propagate through sync.
Cross-user isolation and auth were confirmed: the sync item is keyed to the verified Cognito
`sub`, and unauthenticated/malformed requests get 401/400.

**DEC-052** records the v1 narrowings this session made deliberately: (a) saved routes use
additive union + deletion tombstones, not full per-field record LWW; (b) prefs are pushed but
merge keeps LOCAL prefs — applying remote prefs is deferred; (c) ride-history metadata sync is
deferred; (d) one SYNC item per user, 256KB cap.

**Follow-ups:** per-field prefs LWW (and applying remote prefs on first pull) — DEC-052(b);
ride-history metadata sync — DEC-052(c).
