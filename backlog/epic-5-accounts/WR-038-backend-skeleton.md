# WR-038 · Serverless backend skeleton (CDK, Lambda, DynamoDB)
Epic: 5 · Accounts | Status: DONE | Depends on: WR-037 | Size: L

## Goal
The thin AWS backend everything account-shaped sits on: CDK-defined Lambda handlers behind
Function URLs and a DynamoDB single-table, deployed from CI — small enough to stay ~free, real
enough to build auth and sync on.

## Context (read first)
DECISIONS DEC-039/DEC-042 · CLAUDE.md rule 3 (tests never call live services — same law for
AWS) · ARCHITECTURE §2 (the PWA talks to this only through an adapter).

## Acceptance criteria
- [x] `infra/` AWS CDK app (TypeScript): Lambda handlers (Node) behind **Function URLs** — no
      API Gateway (avoids its per-request cost); DynamoDB **single-table**, on-demand billing,
      encryption at rest via KMS; everything in **eu-north-1** (Stockholm, EU residency).
- [x] `GET /health` Function URL returns the deployed build version; CORS locked to the WR-037
      domain (plus localhost for dev).
- [x] Least-privilege IAM: each Lambda gets only its own table actions on the one table — no
      wildcard resources or actions.
- [x] CI deploy via the WR-037 OIDC role; `cdk diff` visible in the workflow log; no secrets in
      code or repo — config via env/SSM only.
      **Deviation (per DEC-050):** the "CI deploy visible in workflow log" half is deferred —
      DEC-050 scaffolds Epic 5 offline-only (no AWS creds in the dev/CI environment yet); the
      code-complete half (CDK app, OIDC-role-ready, no secrets in repo) is done and gated by
      `cdk synth` + assertions. Live `cdk deploy` stays a documented manual step until the owner
      provisions AWS.
- [x] Single-table key design (`PK=USER#<sub>`, `SK` per record type) documented in `infra/`
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

## Log
Shipped: `infra/lib/backend-stack.ts` — DynamoDB single-table (`PK`/`SK`, `PAY_PER_REQUEST`
on-demand, `AWS_MANAGED` KMS encryption, PITR, `RemovalPolicy.RETAIN`) + one Node 22 Lambda
(`Code.fromAsset('lambda')`) behind a Function URL (`authType: NONE` — public; CORS to the
custom domain + CloudFront domain + localhost) with `grantReadWriteData` (least-priv, table-only).
Region eu-north-1 (DEC-042). Single-table key design (`PK=USER#<sub>`, `SK` per record type)
documented in the class doc comment for WR-040/041. `infra/lambda/index.mjs` routes
`GET /health` (status + build version) and 404s otherwise — pure, unit-tested. `hosting-stack.ts`
now exposes `distributionDomainName` (cross-stack) so the backend can allow the CloudFront
origin; `bin/windride.ts` instantiates `BackendStack` with `allowedOrigins` = custom domain (if
set) + CloudFront domain. Tests: `infra/test/backend-stack.test.ts` (3 CDK assertions) +
`infra/test/health-handler.test.ts` (3 handler unit tests) — hermetic, no live AWS. Offline gate:
12 CDK/handler tests + `cdk synth`, all green; manual `curl` of `/health` documented in
`infra/README.md` as the live check.

Fable review: no criticals. Fixed (1) CORS was localhost-only when deploying without a custom
domain, so a deployed site with only the CloudFront URL couldn't call its own API — now the
CloudFront domain is always an allowed origin via the cross-stack `distributionDomainName` ref.
(2) The least-privilege IAM test was weak (`Match.not('*')`) — replaced with a positive
assertion that every `dynamodb:` IAM statement's `Resource` is the table's `GetAtt` ARN and
contains no wildcard. (3) `infra/README.md` updated with the `BackendStack` section, the public
Function URL / verify-JWT-in-handler warning, deploy order (hosting → backend), and the
`curl /health` smoke test. Also bumped the Lambda runtime to Node 22 (20 nears EOL). Verified
sound: the table is reachable only via the Lambda (handler has zero DynamoDB code in this
skeleton — no data exposure yet); `AWS_MANAGED` KMS satisfies DEC-042's encryption-at-rest at
zero extra cost; the Function URL's built-in CORS handles preflight; asset packaging synths
offline; infra/ isolation from the app toolchain (DEC-050) is intact; no secrets in code or repo.

Two deliberate deviations flagged per CLAUDE.md rule 7 (no new DEC needed — both are covered by
existing decisions):
(a) Used a plain `lambda.Function` + `Code.fromAsset` + a hand-written `.mjs` handler instead of
    the story's suggested `NodejsFunction`/esbuild bundling, so `cdk synth` works fully offline
    with no bundler or Docker daemon required — consistent with DEC-050's offline-scaffold gate.
    Revisit if/when handler code grows enough to want TypeScript + bundling.
(b) The "CI deploy via WR-037 OIDC role / `cdk diff` in workflow log" acceptance criterion is
    superseded by DEC-050: Epic 5 deploys manually (no AWS creds in the dev/CI environment yet).
    The code-complete part (OIDC-role-ready CDK app, no secrets) is done; live CI deploy is
    deferred until the owner provisions AWS.

Follow-ups for later stories: WR-039 (Cognito) will add the JWT verification the README already
warns is mandatory for any non-`/health` route; WR-040/041 build on the documented single-table
key design.
