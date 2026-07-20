# WR-038 · Serverless backend skeleton (CDK, Lambda, DynamoDB)
Epic: 5 · Accounts | Status: TODO | Depends on: WR-037 | Size: L

## Goal
The thin AWS backend everything account-shaped sits on: CDK-defined Lambda handlers behind
Function URLs and a DynamoDB single-table, deployed from CI — small enough to stay ~free, real
enough to build auth and sync on.

## Context (read first)
DECISIONS DEC-039/DEC-042 · CLAUDE.md rule 3 (tests never call live services — same law for
AWS) · ARCHITECTURE §2 (the PWA talks to this only through an adapter).

## Acceptance criteria
- [ ] `infra/` AWS CDK app (TypeScript): Lambda handlers (Node) behind **Function URLs** — no
      API Gateway (avoids its per-request cost); DynamoDB **single-table**, on-demand billing,
      encryption at rest via KMS; everything in **eu-north-1** (Stockholm, EU residency).
- [ ] `GET /health` Function URL returns the deployed build version; CORS locked to the WR-037
      domain (plus localhost for dev).
- [ ] Least-privilege IAM: each Lambda gets only its own table actions on the one table — no
      wildcard resources or actions.
- [ ] CI deploy via the WR-037 OIDC role; `cdk diff` visible in the workflow log; no secrets in
      code or repo — config via env/SSM only.
- [ ] Single-table key design (`PK=USER#<sub>`, `SK` per record type) documented in `infra/`
      for WR-040/041 to follow.

## Test contract
`npm test` stays hermetic: handler unit tests against a mocked DynamoDB document client + CDK
assertions on the synthesized stack (fine-grained asserts over brittle full snapshots). Live
check is a manual `curl` of the health URL — never CI.

## Technical notes
The PWA side gets a `src/adapters/api/` adapter in later stories — fetch stays adapters-only;
UI never calls Function URLs directly. Keep handler code dependency-light (esbuild via CDK
`NodejsFunction`).

## Out of scope
Real endpoints beyond health (WR-040/041) · auth (WR-039).
