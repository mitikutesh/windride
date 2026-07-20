# WR-042 · GDPR: privacy policy, data export, account deletion
Epic: 5 · Accounts | Status: TODO | Depends on: WR-040 | Size: M

## Goal
Accounts make WindRide a data controller (DEC-044). Ship the controller minimum, honestly: a
privacy policy that matches reality, export-my-data, and a delete that actually deletes.

## Context (read first)
DECISIONS DEC-039/DEC-040/DEC-044 · WR-040 (what's stored) · WR-041 (what syncs).

## Acceptance criteria
- [ ] Privacy policy page (static route in the PWA): what is stored server-side (profile,
      entitlement, synced non-secret data), lawful basis (contract — the account features the
      user signed up for), retention (until account deletion; provider backups expire on the
      provider's cycle), the fact that BYO keys and core ride data never leave the browser,
      and a contact for requests.
- [ ] Export-my-data: authenticated endpoint returns ALL of the user's server-side records as
      a single JSON download; UI button on the Account screen.
- [ ] Delete-my-account: authenticated endpoint wipes every DynamoDB item under the user's
      `PK` AND deletes the Cognito user; type-to-confirm UI flow; local idb is untouched
      (that's the user's own device data, not ours).
- [ ] Minimal-PII audit recorded in the Log: nothing beyond email + synced content is stored;
      no analytics or tracking added anywhere in this epic.

## Test contract
Handler tests (mocked DynamoDB + Cognito client): export gathers every record type WR-040/041
define — a new record type failing the export enumeration should fail a test; delete removes
all items and calls admin-delete-user; both 401 unauthenticated. UI: confirm-flow interaction
test (no delete call until the confirmation matches).

## Out of scope
Cookie banners (no third-party cookies exist to consent to) · DPO/representative paperwork ·
data-processing agreements.
