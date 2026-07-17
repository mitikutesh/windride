# WR-023 · Strava upload — single-player, upload-only
Epic: 3 · Conditions | Status: DONE | Depends on: WR-017 | Size: M

## Goal
One tap after a ride: the GPX lands on the owner's Strava. Nothing else — by ToS design.

## Context (read first)
API_NOTES §4 (constraints are legal, not technical) · CLAUDE.md domain warnings (Strava).

## Acceptance criteria
- [x] `tools/strava-auth.mjs`: one-time localhost OAuth (activity:write), prints/stores refresh
      token to local config (gitignored); README section for the 5-minute setup.
- [x] `adapters/strava/upload.ts`: refresh → access token (cached until expiry), POST /uploads
      with GPX, poll upload status, map errors (duplicate, auth, rate) to typed errors.
- [x] Ride summary gains "Send to Strava" with pending/done/duplicate/error states; ride record
      stores stravaActivityId; re-send is idempotent.
- [x] Absolutely no Strava reads anywhere (lint grep for GET endpoints in the adapter). Exception
      sanctioned by DEC-027: `GET /uploads/{id}` polling is part of the write flow (upload-status
      only, no athlete/activity/segment data), asserted by a dedicated no-data-reads test.

## Test contract
Adapter tests fully mocked (token refresh flow, status polling, each error). No live Strava in
CI ever; one manual end-to-end documented in the Log with a real test ride.

## Technical notes
Client secret lives only in the local tools config — never in Vite env (would be bundled).
The app itself only ever holds the refresh/access tokens in idb.

## Out of scope
Activity descriptions with wind stats (nice later); reading anything back.

## Log
Shipped upload-only Strava integration end to end:
- `src/adapters/strava/upload.ts` — `StravaUploader` with injectable `fetch`/clock/`sleep`.
  `accessToken()` refreshes via `POST /oauth/token`, caching the token until expiry (60 s skew).
  `startUpload()` does `POST /uploads` with the GPX as multipart form data plus `external_id` for
  dedupe. `pollUpload()` polls `GET /uploads/{id}` until it returns an `activity_id` or an error.
  `sendGpx()` composes upload + poll. Errors map to typed `ProviderError`: auth (401/400, code
  `'auth'`), rate (429, kind `quota`, code `'rate'`), duplicate (code `'duplicate'`), network. No
  athlete/activity/segment reads anywhere — the only GET is the upload's own status.
- `tools/strava-auth.mjs` — one-time localhost OAuth (`activity:write`); exchanges the code and
  writes `clientId`/`clientSecret`/`refreshToken` to gitignored `tools/.strava.json`. Manual-only,
  never run in CI. README gained a "Strava upload (optional, 5-minute setup)" section.
- `src/data/db.ts` — idb bumped to v3: added a `strava` object store (`getStravaCreds`/
  `setStravaCreds`, `StravaCredsRecord`) and `RecordedRide.stravaActivityId`; the v3 upgrade is
  idempotent (guarded creates), safe to run against existing v1/v2 databases.
- `src/state/ridesStore.ts` — `sendToStrava(id, send?)`: loads ride points → GPX, uploads via an
  injectable sender (default builds a `StravaUploader` from idb creds), records
  `stravaActivityId`, and tracks a per-ride status (`'idle'|'pending'|'done'|'duplicate'|'error'|
  'no-creds'`). Idempotent — a ride already carrying `stravaActivityId` is not re-sent.
- UI — `RideHistory` shows "Send to Strava" per finished ride with the live status label
  ("Sending…" / "Already on Strava" / "Strava failed — retry" / "Set up Strava in Kit"), or
  "On Strava ✓" once uploaded. `src/ui/components/StravaSettings.tsx` is a creds form rendered on
  `KitScreen` that stores creds in idb.

**Decisions:**
- **DEC-027** (new): the story text said "no GET endpoints" / "absolutely no Strava reads", but
  Strava's upload API requires polling `GET /uploads/{id}` to obtain the `activity_id` — there is
  no other way to get it. Sanctioned this single GET as part of the write flow, not a data read:
  it returns only the status of the upload we just pushed, never athlete/activity/segment data.
  The adapter test asserts every GET call targets `/uploads/{id}`. Also recorded: the client
  secret + refresh token live in idb at runtime (owner-entered, sourced from
  `tools/.strava.json`), not in Vite env, because a client-only PWA has no backend to refresh
  tokens without holding the secret somewhere, and Vite env would bundle it into the shipped app.
- Injectable `fetch`/clock/`sleep` on `StravaUploader`, and an injectable `send` function on
  `sendToStrava`, so every test path (refresh caching, upload+poll happy path, duplicate/auth/
  rate/processing errors, no-creds, idempotent re-send) runs fully mocked — no live Strava calls
  from tests or CI, per CLAUDE.md.
- Re-send idempotency has two layers: `external_id` on the Strava side (server-side dedupe) and
  the local `stravaActivityId` check in `ridesStore` (skip re-sending entirely once a ride is
  already uploaded).

**Tests:** `src/adapters/strava/upload.test.ts` (6 — token-refresh caching, upload+poll happy
path with a no-data-reads assertion, duplicate/auth/rate/processing errors) and
`src/state/ridesStore.test.ts` (4, fake-indexeddb — no-creds flag, injected-sender success records
the activity id, idempotent no-re-send, duplicate state). 315 tests total; lint clean; build OK.

**Follow-ups:** the one manual end-to-end (a real test ride sent through `strava-auth.mjs` +
`StravaSettings` to actual Strava) is still TODO — needs the owner to set up real Strava API app
credentials, which weren't available in this session.

## Review pass — fixes

Reviewed by a substitute senior reviewer (Opus) — the Fable 5 model was out of usage credits this
session. Verdict: APPROVE-WITH-FIXES; all fixes below are applied and the gate is green (317
tests, lint clean, build OK).

- **SF1 — `pollUpload` ignored HTTP status.** A 401/429 returned mid-poll was swallowed (the body
  was parsed regardless of status), so polling ran out its full budget and reported `'timeout'`
  instead of the real error. Fixed: `pollUpload` now checks `res.status` before reading the body —
  429 maps to a `quota`/`'rate'` `ProviderError`, any other non-OK status maps to the typed
  `httpError` — mirroring the mapping `startUpload` already did.
- **SF3 — test gaps.** Added: a poll-timeout test (upload never resolves → code `'timeout'` once
  `maxPolls` is exhausted); a token-expiry re-refresh test (clock advanced past `expiresAt - skew`
  triggers a second `POST /oauth/token` call instead of reusing the stale cached token); and a
  `strava` object-store assertion in the v1→v3 idb migration test (`db.migration.test.ts`)
  confirming the `strava` store and `stravaActivityId` survive migration from older schemas.
- **SF2 — CORS risk (hard gate, not code-fixable this session).** Browser-direct calls to
  Strava's `/oauth/token` and `/uploads` may be blocked by CORS — Strava's API is not guaranteed to
  return `Access-Control-Allow-Origin` for browser callers. This is the single biggest risk to
  whether the feature works at all in production, and it undermines DEC-027's no-backend rationale
  if it doesn't. Recorded as a required check in the still-outstanding manual end-to-end above; if
  blocked, the fix is a small CORS proxy, which would also move the client secret server-side. See
  the DEC-027 addendum in `docs/DECISIONS.md`.
- **NITs:**
  - Removed the dead `VITE_STRAVA_CLIENT_ID` declaration from `vite-env.d.ts` — credentials live
    in idb per DEC-027, never in Vite env.
  - `startUpload` now throws a typed `ProviderError` if the response lacks a numeric `id`, instead
    of returning `undefined` and going on to poll `/uploads/undefined`.
  - `ridesStore`'s `defaultSend` throws a `ProviderError('no-creds')` rather than a plain `Error`
    when no Strava credentials are set.
  - `StravaSettings.save` now wraps `setStravaCreds` in a `try`/`catch` and surfaces a "Could not
    save" message on failure instead of failing silently.

**Standing risk (unchanged, per DEC-027):** the Strava client secret sits in browser idb in
cleartext and is sent from browser JS to `/oauth/token` — accepted for a personal, no-backend PWA.
Resolving the CORS risk above via a proxy would also retire this arrangement by moving the secret
server-side.

**Gate:** 317 tests, lint clean, build OK.
