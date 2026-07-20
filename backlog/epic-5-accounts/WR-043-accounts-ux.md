# WR-043 · Accounts-era UX + honest copy update
Epic: 5 · Accounts | Status: TODO | Depends on: WR-041, WR-042 | Size: S

## Goal
Wire auth and sync into the UI without breaking anonymous use — and stop the app lying about
itself: About/Help still say "no account, no backend, everything in your browser".

## Context (read first)
DECISIONS DEC-039/DEC-040 · WR-039 auth adapter · WR-041 sync status · WR-042 policy page.

## Acceptance criteria
- [ ] Account entry point (Kit or header): signed-out shows "Sign in (optional)" and never
      blocks planning; signed-in shows email, sync status (WR-041), sign out, and the
      delete-account flow (WR-042).
- [ ] About/Help rewritten to the honest new framing: core planning and your API keys stay in
      your browser; an optional **free** account syncs saved routes + preferences (non-secret
      data only); AI features run on your own key.
- [ ] Privacy policy linked from About/Help AND from the sign-up flow.
- [ ] Anonymous regression pass recorded in the Log: plan → results → navigate → record with
      no account — no nags, no console errors, no behaviour change.

## Test contract
Render tests for both signed states of the account entry point; a copy test asserting the old
"no account, no backend" phrasing is gone from About/Help; existing UI tests stay green
untouched.

## Out of scope
Onboarding tours · marketing/landing pages · any new sync or auth behaviour (wiring only).
