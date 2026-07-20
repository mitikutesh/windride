# WR-039 · Auth: free registration + login (Cognito)
Epic: 5 · Accounts | Status: DONE | Depends on: WR-038 | Size: L

## Goal
Free sign-up and sign-in — a Cognito user pool, email + password with verification and reset,
and a client auth adapter — while everything the app already does keeps working signed-out.

## Context (read first)
DECISIONS DEC-039/DEC-040/DEC-041 · ARCHITECTURE §2 (adapters-only fetch).

## Acceptance criteria
- [x] Cognito user pool (CDK, eu-north-1): email + password sign-up, email verification,
      password reset; no phone, no forced MFA for v1.
- [x] PWA UI: sign up / sign in / sign out (Kit or an Account screen); error copy is human
      ("wrong password", not a Cognito exception name).
- [x] `src/adapters/auth/`: the only place Cognito endpoints are called; holds the session
      JWT, refreshes tokens silently, exposes `currentUser()` / `getToken()`.
- [x] **Progressive:** every existing feature (plan, navigate, record, BYO keys) works
      signed-out exactly as before — an account only adds capability; no auth wall anywhere
      on the core flow.
- [x] Cognito's **current** free-MAU tier verified against expected usage (pricing changed
      post-2024 — do not trust the old "50k MAU free"); finding recorded in DEC-041. If it
      can't stay free, evaluate Supabase Auth / Clerk behind the same adapter interface
      before building further on Cognito. — recorded in DEC-041 (reconfirm at deploy — no
      AWS account here).

## Test contract
Auth adapter contract tests against `fixtures/` (token parse, refresh flow, expiry, error
paths) — never live Cognito in tests. UI: render + interaction tests for the sign-in/up forms,
both signed states.

## Technical notes
Prefer a light client (plain OIDC/USER_SRP endpoints or `amazon-cognito-identity-js`) over
pulling in Amplify. The JWT is a session credential for OUR backend, not a BYO API key —
DEC-040's never-sync rule governs provider keys, not this token.

## Out of scope
Profile/entitlement records (WR-040) · synced data (WR-041) · social logins.

## Log
Shipped: `infra/lib/auth-stack.ts` (+ CDK assertion test, wired in `infra/bin/windride.ts`) —
a Cognito UserPool (email self-signup, autoVerify email, password policy, MFA OFF,
EMAIL_ONLY account recovery, `deletionProtection: true`, `RemovalPolicy.RETAIN`) with a PUBLIC
web client (no client secret, `USER_PASSWORD_AUTH` + refresh-token auth, hosted-UI/OAuth
disabled, `preventUserExistenceErrors`) — outputs pool id / client id / region.
`src/adapters/auth/{types.ts,cognito.ts}` — `CognitoAuthClient` talks to
`cognito-idp.<region>.amazonaws.com` with plain `fetch` (no AWS SDK, no secret): `signUp`,
`confirmSignUp`, `resendConfirmationCode`, `signIn` (`USER_PASSWORD_AUTH`), `refresh`
(`REFRESH_TOKEN_AUTH`, reuses the refresh token), `forgotPassword`, `confirmForgotPassword`;
region + client id read from `VITE_COGNITO_REGION`/`VITE_COGNITO_CLIENT_ID` (PUBLIC config,
not secrets); injectable `fetch` for hermetic tests; Cognito `__type` → `ProviderError`
code mapping (`auth`/`quota`/`network`); `authConfigured()` guard.
`src/state/authStore.ts` — persisted (idb via zustand `persist`) session state machine:
`signUp`/`confirm`/`resend`/`signIn`/`requestReset`/`confirmReset`/`signOut` +
`ensureFreshToken` (silent refresh with a 60 s expiry skew), cause-named human error copy,
`currentIdToken()` as the token-read seam (the story's `currentUser()`/`getToken()` shape,
named to match what it returns). Unconfirmed sign-in routes back to the confirmation step
instead of dead-ending. Injectable client for tests.
`src/ui/components/AuthPanel.tsx` — real sign up/in/out, confirm (+ resend), and password
reset (forgot → code + new password) forms; opt-in in Kit under "Account (optional)"; shows
"not set up" when unconfigured; fully progressive (every existing feature keeps working
signed-out).
`src/vite-env.d.ts` types `VITE_COGNITO_REGION`/`VITE_COGNITO_CLIENT_ID`; `.env.example`
documents them.

Fable review found two criticals, both fixed this session: (1) password reset was built into
the adapter but had no reachable UI path even though it's an acceptance item — added the
forgot/confirm-reset flow to `AuthPanel`; (2) an unconfirmed account signing in hit a dead
end — sign-in now detects the unconfirmed case and routes back to the confirmation step, with
a resend-code action. Hardening from the same review: typed the new `VITE_COGNITO_*` env vars;
added `ensureFreshToken` as a real, expiry-checked silent-refresh seam (UI auto-wiring of the
refresh timer is WR-040, not this story); `deletionProtection` on the user pool; a fallback for
Cognito's capital-`Message` error field; Enter-to-submit on the forms; `role="alert"` on error
copy. Verified during review: region/client id are public config (no client secret anywhere in
the bundle); BYO provider keys (DEC-034/DEC-040) never touch the auth session; tokens
persisted to idb is a deliberate, documented trade-off consistent with the Strava-credential
precedent (DEC-027); the Cognito wire protocol (`X-Amz-Target` actions, request/response
shapes) is correct against the fixtures; module boundary is clean (UI → store → adapter,
`Session` re-exported from the store, no UI→adapters import).

DEC-041 finding: Cognito's exact current free-MAU allotment could not be verified from this
dev environment (no AWS account/console access). What's known without one: AWS restructured
Cognito pricing in November 2024, replacing the flat "50k MAU free" allowance with tiered
feature plans ("Lite"/"Essentials"/"Plus") — the actual free quota now depends on the selected
plan and must not be assumed to match the old baseline. Decision stands (Cognito is the
default, wrapped behind `AuthClient` so Supabase Auth/Clerk are drop-in fallbacks); DEC-041
stays DEFAULT-open, with live-pricing reconfirmation now an explicit deploy-time gate rather
than something this session could close.

Gates green: app 611 tests + lint + build; infra 16 tests + `cdk synth`. No live AWS/Cognito
calls anywhere in the suite (hermetic per CLAUDE.md rule 3).

Follow-ups: wire the UI-side auto-refresh timer around `ensureFreshToken` (WR-040); MFA
deferred (still no forced MFA for v1, as scoped); profile/entitlement records (WR-040) and
cross-device sync (WR-041) are next in the epic.
