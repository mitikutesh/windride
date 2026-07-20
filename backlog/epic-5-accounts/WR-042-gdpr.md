# WR-042 · GDPR: privacy policy, data export, account deletion
Epic: 5 · Accounts | Status: DONE | Depends on: WR-040 | Size: M

## Goal
Accounts make WindRide a data controller (DEC-044). Ship the controller minimum, honestly: a
privacy policy that matches reality, export-my-data, and a delete that actually deletes.

## Context (read first)
DECISIONS DEC-039/DEC-040/DEC-044 · WR-040 (what's stored) · WR-041 (what syncs).

## Acceptance criteria
- [x] Privacy policy page (static route in the PWA): what is stored server-side (profile,
      entitlement, synced non-secret data), lawful basis (contract — the account features the
      user signed up for), retention (until account deletion; provider backups expire on the
      provider's cycle), the fact that BYO keys and core ride data never leave the browser,
      and a contact for requests.
- [x] Export-my-data: authenticated endpoint returns ALL of the user's server-side records as
      a single JSON download; UI button on the Account screen.
- [x] Delete-my-account: authenticated endpoint wipes every DynamoDB item under the user's
      `PK` AND deletes the Cognito user; type-to-confirm UI flow; local idb is untouched
      (that's the user's own device data, not ours).
- [x] Minimal-PII audit recorded in the Log: nothing beyond email + synced content is stored;
      no analytics or tracking added anywhere in this epic.

## Test contract
Handler tests (mocked DynamoDB + Cognito client): export gathers every record type WR-040/041
define — a new record type failing the export enumeration should fail a test; delete removes
all items and calls admin-delete-user; both 401 unauthenticated. UI: confirm-flow interaction
test (no delete call until the confirmation matches).

## Out of scope
Cookie banners (no third-party cookies exist to consent to) · DPO/representative paperwork ·
data-processing agreements.

## Log
**Shipped.** `infra/lambda/store.mjs` gained `exportUserData` (paginated `Query` over every
`USER#<sub>` item), `deleteUserData` (paginated `Query` + `BatchWrite`, retrying
`UnprocessedItems` up to 5 times per batch and throwing rather than reporting success on a
partial wipe) and `deleteCognitoUser` (`AdminDeleteUser`). `infra/lambda/index.mjs` exposes them
as authenticated `GET /export` and `DELETE /me`; `DELETE /me` removes the Cognito login FIRST,
then wipes the DynamoDB data, so a failure partway through can never leave a usable login that
goes on to re-create data. `infra/lib/backend-stack.ts` grants the API's execution role
`cognito-idp:AdminDeleteUser` on the user pool ARN only (no wildcard action or resource),
covered by a CDK assertion test; `infra/bin/windride.ts` threads the pool ARN through.
On the client: `src/adapters/api/{types,client}.ts` add `exportData`/`deleteAccount`;
`src/state/gdprStore.ts` drives export (triggers a JSON download) and delete (server erasure,
then local sign-out), fully dependency-injected for tests. `src/ui/components/AuthPanel.tsx`
gets an "Export my data" action and a type-to-confirm delete flow (typing `DELETE` enables the
button), both gated on the backend being configured, plus an always-visible "Privacy & your
data" link. `src/ui/screens/PrivacyScreen.tsx` (routed at `#/privacy`, linked from the app
footer) states plainly: no-account = everything stays on-device; with-account = email, saved
routes/prefs, entitlement tier and created-at are stored server-side; lawful basis is the
account contract (DEC-044); region is eu-north-1 (DEC-042); keys and core ride data never leave
the browser (DEC-040); retention is until deletion, with a disclosed ~35-day PITR backup tail;
and how to export or delete.

**Fable review, fixed:**
- (Critical) The original two-step client-driven delete could leave a "half-deleted" account —
  data wiped but the Cognito login still alive (or vice versa), letting a stale session
  re-create records. Moved the Cognito deletion server-side and ordered it FIRST in
  `handleDeleteAccount`, so the login is gone before the wipe starts; there is no window where
  a live session and missing data coexist.
- (Critical) The delete confirmation was a bare `window.confirm`. Replaced with an in-panel
  type-to-confirm flow (must type `DELETE`) plus an interaction test asserting no delete call
  fires until the text matches.
- (Important) The privacy copy said data storage was "the whole list" while omitting the
  entitlement tier and the backup retention tail. Now lists entitlement + created-at explicitly
  and discloses the ~35-day PITR backup window after deletion.
- (Important) `deleteUserData` had no pagination or retry; a large item set or a throttled
  `BatchWrite` could silently under-delete while still reporting success. Added `Query`
  pagination and `UnprocessedItems` retry (throws instead of reporting success on a partial
  wipe).
- (Minor) Removed an em-dash from the delete-error copy (owner's no-em-dash preference).
- GDPR actions (export/delete) are gated on `apiConfigured`, matching how the rest of
  `AuthPanel` treats the backend as optional.

**Minimal-PII audit:** email is the only personal data collected (a Cognito requirement); saved
routes and plan preferences are the user's own non-secret content, not identifying by
themselves; entitlement tier and created-at are account metadata, not PII beyond the account
itself. BYO provider keys (`ors`/`digitransit`/`ai`) never leave the browser (DEC-040) and are
structurally excluded from the sync payload (DEC-052), so they can never appear in an export or
need deletion server-side. No analytics or tracking exists anywhere in the app.

**Known limitation:** `store.mjs`'s `exportUserData`/`deleteUserData`/`deleteCognitoUser` use
the runtime-provided AWS SDK via lazy `import()` (no bundled SDK, per the offline-scaffold
approach in DEC-050), so they are exercised through the Lambda handler tests with an injected
fake store (`infra/test/api-routes.test.ts`) rather than a unit test mocking DynamoDB/Cognito
clients directly — consistent with how the rest of `store.mjs` is already tested.

**Follow-ups:** none blocking; WR-043 (accounts-era UX + honest copy) is the next story and can
cross-check the Privacy page copy once the rest of the accounts UX lands.
