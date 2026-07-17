# WR-023 · Strava upload — single-player, upload-only
Epic: 3 · Conditions | Status: TODO | Depends on: WR-017 | Size: M

## Goal
One tap after a ride: the GPX lands on the owner's Strava. Nothing else — by ToS design.

## Context (read first)
API_NOTES §4 (constraints are legal, not technical) · CLAUDE.md domain warnings (Strava).

## Acceptance criteria
- [ ] `tools/strava-auth.mjs`: one-time localhost OAuth (activity:write), prints/stores refresh
      token to local config (gitignored); README section for the 5-minute setup.
- [ ] `adapters/strava/upload.ts`: refresh → access token (cached until expiry), POST /uploads
      with GPX, poll upload status, map errors (duplicate, auth, rate) to typed errors.
- [ ] Ride summary gains "Send to Strava" with pending/done/duplicate/error states; ride record
      stores stravaActivityId; re-send is idempotent.
- [ ] Absolutely no Strava reads anywhere (lint grep for GET endpoints in the adapter).

## Test contract
Adapter tests fully mocked (token refresh flow, status polling, each error). No live Strava in
CI ever; one manual end-to-end documented in the Log with a real test ride.

## Technical notes
Client secret lives only in the local tools config — never in Vite env (would be bundled).
The app itself only ever holds the refresh/access tokens in idb.

## Out of scope
Activity descriptions with wind stats (nice later); reading anything back.

## Log
