# WR-039 · Auth: free registration + login (Cognito)
Epic: 5 · Accounts | Status: TODO | Depends on: WR-038 | Size: L

## Goal
Free sign-up and sign-in — a Cognito user pool, email + password with verification and reset,
and a client auth adapter — while everything the app already does keeps working signed-out.

## Context (read first)
DECISIONS DEC-039/DEC-040/DEC-041 · ARCHITECTURE §2 (adapters-only fetch).

## Acceptance criteria
- [ ] Cognito user pool (CDK, eu-north-1): email + password sign-up, email verification,
      password reset; no phone, no forced MFA for v1.
- [ ] PWA UI: sign up / sign in / sign out (Kit or an Account screen); error copy is human
      ("wrong password", not a Cognito exception name).
- [ ] `src/adapters/auth/`: the only place Cognito endpoints are called; holds the session
      JWT, refreshes tokens silently, exposes `currentUser()` / `getToken()`.
- [ ] **Progressive:** every existing feature (plan, navigate, record, BYO keys) works
      signed-out exactly as before — an account only adds capability; no auth wall anywhere
      on the core flow.
- [ ] Cognito's **current** free-MAU tier verified against expected usage (pricing changed
      post-2024 — do not trust the old "50k MAU free"); finding recorded in DEC-041. If it
      can't stay free, evaluate Supabase Auth / Clerk behind the same adapter interface
      before building further on Cognito.

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
