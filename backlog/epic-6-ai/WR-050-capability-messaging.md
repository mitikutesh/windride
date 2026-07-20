# WR-050 · Capability readiness + honest missing/failing messaging
Epic: 6 · AI | Status: TODO | Depends on: WR-044 | Size: M

## Goal
One consistent, honest pattern for "this needs a key or setup you don't have". Every feature
that depends on a user-supplied key or provider either hides/disables cleanly, or — when the
user reaches for it — says plainly WHAT is missing and WHERE to fix it (the exact Kit setting).
And when a configured provider FAILS, the message names the likely cause and the fix, never a
bare "failed, retry".

## Context (read first)
DEC-034 (keychain) · DEC-036 (the existing missing-routing-key banner + first-run prompt — the
pattern to generalize) · DEC-043 (AI is BYO key + per-user provider) · `ridesStore`
`stravaFailureReason` (Strava reason strings already in place) · CLAUDE.md honesty gate +
human-copy rule.

## Acceptance criteria
- [ ] A small capability model (one `capabilities.ts` selector, reactive to the keychain store):
      for each capability — routing/ORS, transit/Digitransit, Strava upload, AI — a single
      source of truth for "ready? / why not? / which Kit setting fixes it".
- [ ] AI features (WR-045+): with no AI key OR no provider selected, the entry points are
      disabled/hidden with a one-line reason + a link to Kit → AI ("Add your AI key and pick a
      provider to use ride briefings, natural-language planning and route discovery"). Trying
      to invoke one never throws — it routes to the same message.
- [ ] Strava: a failed upload already carries a reason (auth/scope/rate/network); surface it at
      the point of action AND, for the auth/scope case, link to Kit → Strava with the concrete
      fix (re-authorise with `activity:write`, paste the new refresh token).
- [ ] Routing/transit: fold the existing Plan missing-key banner (DEC-036) into the same model
      so all messages read consistently; keep Digitransit-absent as the soft "check return
      times" degrade, never an error.
- [ ] Messages are specific and actionable (name the key/provider + the Kit destination), never
      a bare "something went wrong"; copy is human-toned (no owner/AI tells, per the copy rule).

## Test contract
Render tests: each capability in {ready, no-key, no-provider (AI only), call-failed} shows the
right message + link; invoking a not-ready AI feature no-ops with the message instead of
throwing. Reuse the existing Strava-reason tests. No live calls (rule 3).

## Technical notes
Prefer one selector over scattered `if (!key)` checks so a newly-saved key flips every dependent
surface live (as the routing banner already does). Keep the capability list open for future keys.

## Out of scope
The AI features themselves (WR-045+) · new key types beyond the current keychain · backend/account
readiness states (Epic 5).
