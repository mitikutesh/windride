# WR-040 · User profile + free-subscription entitlement
Epic: 5 · Accounts | Status: DONE | Depends on: WR-039 | Size: M

## Goal
A server-side user record plus an explicit entitlement, so "what a free account actually
unlocks" is a fact in DynamoDB, not vibes — and the base every sync/GDPR story reads from.

## Context (read first)
DECISIONS DEC-039 (free tier definition) · DEC-042 (table design, WR-038's key doc) ·
DEC-044 (minimal PII).

## Acceptance criteria
- [x] DynamoDB items under `PK=USER#<sub>`: a profile record (created-at, email — nothing
      more) and an entitlement record (`plan: "free"`, unlocked features). **Annotated:**
      shipped as ONE item (`PK=USER#<sub>`, `SK=PROFILE`) carrying an `entitlement` string
      instead of separate PROFILE + ENTITLEMENT records with an unlocked-features list — see
      DEC-051 (deliberate deviation, rationale there).
- [x] Authenticated `GET /me` Lambda (Function URL, verifies the Cognito JWT signature +
      audience) returns profile + entitlement; 401 on missing/bad/expired token.
- [x] Free-tier definition recorded (DEC-039 default): free = **cross-device sync of saved
      routes + preferences**; AI stays BYO-key client-side and is NOT a server entitlement.
- [x] Profile + entitlement created on registration (Cognito post-confirmation trigger, or
      upsert on first `/me` — pick one, record the choice in the Log). **Chosen: upsert on
      first `/me` call** (`getOrCreateProfile`, race-safe via `ConditionExpression` + re-read
      on `ConditionalCheckFailedException`) — no extra Cognito trigger Lambda to wire/deploy.
- [x] Minimal PII: no name/phone/address fields exist anywhere; email only because Cognito
      requires it (groundwork for WR-042).

## Test contract
Handler tests with mocked DynamoDB + fixture JWTs (stubbed verification keys): happy path,
401 paths, first-call upsert idempotency. Client: `/me` parsing + 401 handling in the api
adapter against fixtures.

## Out of scope
Actual sync (WR-041) · paid tiers (none planned — free is the only plan).

## Log
Shipped: `infra/lambda/jwt.mjs` — Cognito JWT verification in-handler (the Function URL is
public/authType NONE): `decodeJwt`, `verifyRs256` (node:crypto RS256, algorithm forced so
alg-confusion/`none` can't bypass), `assertClaims` (exp/iss/aud|client_id/token_use/sub),
`makeVerifier` (JWKS fetch + in-memory cache, refetch-once on `kid` rotation). `infra/lambda/
index.mjs` — `GET /me`: verify bearer JWT → `getOrCreateProfile(sub, email)` → profile; 401 on
missing/invalid token; 500 JSON (not an unhandled crash) on a store error; verify/store are
injectable for handler tests. `infra/lambda/store.mjs` — DynamoDB single-table
`getOrCreateProfile` (`PK=USER#<sub>`, `SK=PROFILE`), AWS SDK lazily imported (runtime-provided,
keeps `Code.fromAsset` bundler-free and the handler unit-testable without `@aws-sdk` installed),
race-safe via `ConditionExpression: attribute_not_exists(PK)` + re-read of the winning item on
`ConditionalCheckFailedException`. `infra/lib/backend-stack.ts` + `infra/bin/windride.ts` — Lambda
gets `COGNITO_REGION`/`COGNITO_USER_POOL_ID`/`COGNITO_CLIENT_ID` env, wiring AuthStack (WR-039)
into BackendStack (WR-038). Client: `src/adapters/api/{types,client}.ts` —
`HttpApiClient.getMe` (Bearer id token, `VITE_API_URL` base, 401 → auth error) + `apiConfigured()`.
`src/state/profileStore.ts` — `load()` via `authStore.ensureFreshToken` → `getMe`, injectable,
progressive (gated on `apiConfigured()`). `src/ui/components/AuthPanel.tsx` shows the
plan/entitlement when signed in + backend configured, auto-loads on sign-in, and states "keys stay
in this browser, never synced" (DEC-040). `vite-env.d.ts` + `.env.example` document
`VITE_API_URL` (public, not a secret).

JWT verification is unit-tested (`infra/test/jwt.test.ts`) against a locally generated RSA
keypair — no live Cognito call, consistent with CLAUDE.md rule 3.

Fable review: JWT verification confirmed SOUND — no bypass path (algorithm forced to RS256,
`none`/HS256 rejected, signature checked before claims, `exp`/`iss`/`aud` enforced); identity is
the verified `sub` only, so there's no cross-user access; email comes from the verified claims,
never the raw request. Three fixes applied from the review: (1) Important — the race loser in
`getOrCreateProfile` now re-reads and returns the winning profile instead of surfacing a 500;
(2) Important — `/me` wraps the store call so a store failure returns a JSON 500, not an
unhandled Lambda error; (3) hardening — the JWKS cache refetches once on an unknown `kid` (key
rotation) before giving up. Also verified: DEC-040 (only the id token goes to the backend, never
a BYO key), least-privilege table-only IAM, the lazy SDK import keeps `cdk synth` bundler-free
while keeping the handler unit-testable, and progressive gating (no backend configured ⇒ the
panel silently stays off).

DEC-051 recorded: profile + entitlement collapsed to one DynamoDB item (`entitlement` string,
only `'free'` today) instead of the AC's separate PROFILE + ENTITLEMENT records with an explicit
unlocked-features list — simpler to read/write/export for WR-041/042, and the free tier's
capabilities are derivable from the tier name rather than stored as a list.

Follow-ups: entitlement modeling will need to expand (either new fields on this item or a
separate ENTITLEMENT item) once a paid tier actually exists — no migration of existing free
users should be required when that happens.
