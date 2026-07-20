# WR-050 · Capability readiness + honest missing/failing messaging
Epic: 6 · AI | Status: DONE | Depends on: WR-044 | Size: M

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
- [x] A small capability model (one `capabilities.ts` selector, reactive to the keychain store):
      for each capability — routing/ORS, transit/Digitransit, Strava upload, AI — a single
      source of truth for "ready? / why not? / which Kit setting fixes it".
- [x] AI features (WR-045+): with no AI key OR no provider selected, the entry points are
      disabled/hidden with a one-line reason + a link to Kit → AI ("Add your AI key and pick a
      provider to use ride briefings, natural-language planning and route discovery"). Trying
      to invoke one never throws — it routes to the same message.
- [x] Strava: a failed upload already carries a reason (auth/scope/rate/network); surface it at
      the point of action AND, for the auth/scope case, link to Kit → Strava with the concrete
      fix (re-authorise with `activity:write`, paste the new refresh token).
- [x] Routing/transit: fold the existing Plan missing-key banner (DEC-036) into the same model
      so all messages read consistently; keep Digitransit-absent as the soft "check return
      times" degrade, never an error.
- [x] Messages are specific and actionable (name the key/provider + the Kit destination), never
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

## Log
Shipped one honest capability model: `engine/capabilities.ts` (pure — `routingCapability` /
`transitCapability` / `aiCapability`, each returning `{ready, reason, fixHref, fixLabel, soft}`
from a plain `CapabilitySnapshot`) + `state/useCapabilities.ts` (reactive `useCapability(name)`
hook mapping the keychain store's keys/provider/live-APIs flag into that snapshot) + a shared
`ui/components/CapabilityNotice.tsx` (renders the reason + a Kit link when not ready, nothing
when ready). Mock mode (`liveApis` off) reads routing/transit as ready with no key needed;
transit is `soft` (degrades to "check return times", never an error); AI names the precise gap —
no provider chosen vs. provider chosen but no key — rather than one generic "not set up" line.
`PlanScreen`/`ResultsScreen`/`RideRecap` now gate AI entry points on the single
`useCapability('ai').ready` and show a `CapabilityNotice` instead of silently hiding when it
isn't ready; invoking a not-ready AI feature no-ops into the same message, never throws.
`MissingKeyBanner` was refactored to source its ready/reason/link from `useCapability('routing')`,
folding DEC-036's banner into this model instead of running a parallel check.

AI feature *failures* (as opposed to not-set-up) are now centralised in
`state/aiMessages.ts`: `AI_NOT_SET_UP` for the guard, and `aiFailureReason(e, feature)` — one
mapping from a `ProviderError` to cause-naming copy (auth → "check it in Kit → AI", quota → try
later, network → check your connection) — used by `briefingStore`, `recapStore`, `nlPlanStore`
and `discoveryStore`, replacing four previously-divergent inline "try again" messages.

`ridesStore` now exposes `stravaErrorCode` ('auth'|'rate'|'network'|'other') alongside the
existing `stravaFailureReason` copy; `RideHistory` shows the "Fix in Kit → Strava" link only for
auth/scope + no-creds cases, and stays retry-only copy for rate/network — a failed upload never
implies a settings problem when it's actually a rate limit or a dropped connection.

**Fable review** — fixed: (Critical) AI provider-*failure* messaging was still bare "try again"
in briefing/recap before this pass; now centralised so all three live AI features say the same
honest, cause-naming thing. (Important) Strava's Kit link was not kind-aware; now gated to
auth/no-creds only. (Important) `aiReady` was recomputed locally in three places (Plan, Results,
RideRecap); now a single `useCapability('ai')` read everywhere. (Minor) `MissingKeyBanner` copy
de-duplicated against the capability model. Verified: parity with DEC-036's env-fallback path
(a build-time `VITE_ORS_API_KEY` still counts as "has a routing key"), reactivity (saving a key
flips every dependent surface live, no reload), engine purity, and the adapters/UI boundary.

**DEC-049** records a deliberate scope line: Strava stays *outside* `engine/capabilities.ts`.
Its readiness depends on OAuth creds in a separate idb store (Kit → Strava), not the keychain
this model reads, and its failures are inherently point-of-action (you only learn "auth" vs.
"rate" vs. "network" after an upload attempt) — so it continues to surface via
`ridesStore.stravaErrorCode` in `RideHistory` rather than through a capability selector. The
acceptance box is satisfied by that existing, now kind-aware mechanism rather than by folding
Strava into the shared model.

Follow-ups: Kit doesn't yet have per-section anchors, so `fixHref` (`#/kit`) lands on the top of
the Kit screen rather than scrolled to API keys/AI/Strava specifically — worth adding anchors
once Kit has enough sections to make that matter. Also: no screen currently renders a
`CapabilityNotice` for `transit` — Digitransit-absent still shows only the existing per-card
"check return times" copy; wiring a transit notice into Plan/Results is optional future polish,
not required by this story's acceptance (transit is explicitly the soft-degrade case).
