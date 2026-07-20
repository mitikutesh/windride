# WR-043 · Accounts-era UX + honest copy update
Epic: 5 · Accounts | Status: DONE | Depends on: WR-041, WR-042 | Size: S

## Goal
Wire auth and sync into the UI without breaking anonymous use — and stop the app lying about
itself: About/Help still say "no account, no backend, everything in your browser".

## Context (read first)
DECISIONS DEC-039/DEC-040 · WR-039 auth adapter · WR-041 sync status · WR-042 policy page.

## Acceptance criteria
- [x] Account entry point (Kit or header): signed-out shows "Sign in (optional)" and never
      blocks planning; signed-in shows email, sync status (WR-041), sign out, and the
      delete-account flow (WR-042).
- [x] About/Help rewritten to the honest new framing: core planning and your API keys stay in
      your browser; an optional **free** account syncs saved routes + preferences (non-secret
      data only); AI features run on your own key.
- [x] Privacy policy linked from About/Help AND from the sign-up flow.
- [x] Anonymous regression pass recorded in the Log: plan → results → navigate → record with
      no account — no nags, no console errors, no behaviour change.

## Test contract
Render tests for both signed states of the account entry point; a copy test asserting the old
"no account, no backend" phrasing is gone from About/Help; existing UI tests stay green
untouched.

## Out of scope
Onboarding tours · marketing/landing pages · any new sync or auth behaviour (wiring only).

## Log
Shipped the honest accounts-era rewrite of About/Help/Privacy plus the sign-up-flow privacy
link, closing out the last "no backend, no account" holdovers from the pre-Epic-5 copy:

- `HelpScreen.tsx` (+test): reframed the keys section ("runs in your browser and works without
  an account"); added a new "The optional account" section — you never need to sign in; an
  account syncs saved routes (and backs up a few plan preferences) via `Kit → Account`; it never
  touches keys, recordings or speed calibration; links Privacy. Fixed the "Why do I need my own
  API keys?" and "Is my ride data private?" FAQs to describe the optional sync accurately instead
  of asserting no server/no account exists.
- `AboutScreen.tsx` (+test): rewrote the Architecture list — planning/navigation are client-side
  and need no account; added a bullet for the optional free account (routes sync, prefs backed
  up, via a small serverless backend, AWS EU) that keys never join, linking Privacy; added a
  bullet on AI features being BYO-key/browser-called/validated.
- `PrivacyScreen.tsx` + `AuthPanel.tsx`: corrected the prefs claim everywhere to match DEC-052(b)
  — routes sync, prefs are backed up (not yet restored) — instead of implying full two-way sync.
  Added a Privacy link directly in the sign-up/register form (GDPR transparency at the point of
  collection, not just from About/Help). Fixed the stale unconfigured-build copy in `AuthPanel`
  ("will later sync" → present/conditional, since sync ships when configured) and removed
  em-dashes from the account copy (owner style preference).
- `README.md`: dropped the now-false "no backend" claims (top blurb + Deploy section); the app
  is still a static PWA that works fully without the optional backend, which now lives in
  `infra/` (Epic 5) and is called out as such.
- No new DEC: DEC-039 (progressive multi-user pivot) and DEC-052(b) (prefs are backed up, not
  yet restored, on the local/anonymous device) already cover every claim this story needed to
  make accurate — this story is copy/UX only, no new product decisions.

**Fable review** caught two Critical and two Important gaps, all fixed before close:
- (Critical) Privacy wasn't linked from the sign-up flow itself, only from About/Help → added
  the link inside the register form in `AuthPanel.tsx`.
- (Critical) No test asserted the *old* false copy was actually gone → added negative copy tests
  to both `HelpScreen.test.tsx` and `AboutScreen.test.tsx` asserting "no server and no account",
  "built for one person", "No backend, no account", and "nothing to pay to run it" no longer
  render.
- (Important) The prefs claim over-promised (implied full sync) on Help/About/Privacy → corrected
  on all three to "backed up" per DEC-052(b).
- (Important) `AuthPanel`'s unconfigured-build copy was stale ("will later sync") and used
  em-dashes → fixed to present/conditional phrasing, em-dashes removed from all touched account
  copy.
- Fable additionally confirmed: no false absolutes remain in About/Help; keys-never-synced holds
  and is guarded (DEC-040); recordings/calibration never sync; the AWS-EU/AI/export/delete claims
  match the shipped code; About/Help/Privacy tell one consistent story.

**Anonymous regression pass:** the whole test suite doubles as this story's regression — CI and
local `npm test` run with no Cognito, sync-API, or AI env configured, i.e. signed-out,
backend-less, keyless is the default test environment. All 640 tests pass, lint is clean, and the
production build succeeds in that same unconfigured state. `Plan`, `Results`, `Ride` and `Kit`
render and exercise core planning/navigation/recording with zero auth references — confirming, in
the exact environment the acceptance box asks about, that plan → results → navigate → record
works end-to-end with no account, no nags, and no behaviour change from before Epic 5.

This closes **Epic 5 · Accounts & Cloud (v0.5)** — WR-037 through WR-043 are now all DONE.
