# WR-040 · User profile + free-subscription entitlement
Epic: 5 · Accounts | Status: TODO | Depends on: WR-039 | Size: M

## Goal
A server-side user record plus an explicit entitlement, so "what a free account actually
unlocks" is a fact in DynamoDB, not vibes — and the base every sync/GDPR story reads from.

## Context (read first)
DECISIONS DEC-039 (free tier definition) · DEC-042 (table design, WR-038's key doc) ·
DEC-044 (minimal PII).

## Acceptance criteria
- [ ] DynamoDB items under `PK=USER#<sub>`: a profile record (created-at, email — nothing
      more) and an entitlement record (`plan: "free"`, unlocked features).
- [ ] Authenticated `GET /me` Lambda (Function URL, verifies the Cognito JWT signature +
      audience) returns profile + entitlement; 401 on missing/bad/expired token.
- [ ] Free-tier definition recorded (DEC-039 default): free = **cross-device sync of saved
      routes + preferences**; AI stays BYO-key client-side and is NOT a server entitlement.
- [ ] Profile + entitlement created on registration (Cognito post-confirmation trigger, or
      upsert on first `/me` — pick one, record the choice in the Log).
- [ ] Minimal PII: no name/phone/address fields exist anywhere; email only because Cognito
      requires it (groundwork for WR-042).

## Test contract
Handler tests with mocked DynamoDB + fixture JWTs (stubbed verification keys): happy path,
401 paths, first-call upsert idempotency. Client: `/me` parsing + 401 handling in the api
adapter against fixtures.

## Out of scope
Actual sync (WR-041) · paid tiers (none planned — free is the only plan).
