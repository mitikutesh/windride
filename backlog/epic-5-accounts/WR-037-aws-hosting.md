# WR-037 · AWS static hosting + custom domain
Epic: 5 · Accounts | Status: DONE | Depends on: — | Size: M

## Goal
Move the deployed PWA from GitHub Pages to S3 + CloudFront under a custom HTTPS domain — the
stable home the accounts era needs (Cognito callbacks, a privacy-policy URL, no `/windride/`
subpath contortions).

## Context (read first)
DECISIONS DEC-036 (Pages deploy — this supersedes its hosting half) · DEC-039 · CLAUDE.md
golden rule 6 (secrets).

## Acceptance criteria
- [x] Private S3 bucket (CloudFront OAC only, no public access) + CloudFront distribution +
      ACM certificate (issued in **us-east-1** — CloudFront requires it) serving the app over
      HTTPS on the custom domain; default root object `index.html`. Code-complete in
      `infra/lib/hosting-stack.ts` (BLOCK_ALL bucket, S3-managed encryption, enforceSSL,
      `S3BucketOrigin.withOriginAccessControl`, redirect-to-https, optional custom domain +
      ACM cert with the us-east-1 requirement enforced at synth). Live HTTPS-on-custom-domain
      serving is a manual `cdk deploy` → DEC-050 / `infra/README.md` (no AWS account in this
      dev environment).
- [x] Cache policy: hashed `assets/*` long-lived + immutable; `index.html`, `sw.js`,
      `manifest.webmanifest` no-cache (or short TTL) **plus** a CloudFront invalidation on
      deploy — a stale service worker must never pin an old app. Implemented in
      `.github/workflows/deploy-aws.yml`: no-cache is the default for the whole sync, and only
      content-hashed `assets/*` + `workbox-*.js` are re-stamped immutable afterward, with a
      CloudFront invalidation of the entry points + `/data/*`. Live verification (hard refresh
      picks up a new deploy) is manual → DEC-050.
- [x] Build with `VITE_BASE=/` and `VITE_LIVE_APIS=true`; PWA scope/`start_url`/SW verified at
      the domain root (the DEC-036 subpath accommodations keep working locally, unused here).
      Workflow builds with both env vars set. Actual PWA scope/SW verification at a live domain
      root requires a deploy → manual, DEC-050.
- [x] GitHub Actions deploy authenticates via an **OIDC-assumed IAM role** — no long-lived AWS
      keys in repo secrets; the lint + test + accept gate still runs before publish (DEC-036).
      `deploy-aws.yml` uses `id-token: write` + `aws-actions/configure-aws-credentials` (OIDC
      role assume, credentials configured only after `npm ci`/build/gate), no AWS access keys
      anywhere in the repo. The one-time OIDC provider + role trust setup (repo+environment/ref
      scoped) is a manual step, documented in `infra/README.md`.
- [x] No key is baked: the workflow never sets `VITE_ORS_API_KEY` etc.; the deployed app stays
      live-but-keyless (DEC-034/DEC-036) until a user brings keys. Verified by inspection —
      `deploy-aws.yml` sets only `VITE_BASE`/`VITE_LIVE_APIS`, never a provider key.

## Test contract
No live AWS in `npm test`/CI beyond the deploy job itself. Manual smoke, recorded in the Log:
fresh browser → domain loads over HTTPS and installs as a PWA; a hard refresh after a deploy
picks up the new `index.html` without clearing site data.

## Technical notes
Infra may start minimal (console or a small CDK stub) but document what exists — WR-038's CDK
app should absorb it. Keep the Pages workflow until the domain deploy is verified, then retire
it in the same story.

## Out of scope
Backend resources (WR-038) · auth (WR-039).

## Log
Scaffolded Epic 5's first story offline (no AWS credentials in this dev environment) per the
user's "scaffold now, deploy later" decision — see DEC-050.

**Shipped:**
- `infra/` — a new, self-contained AWS CDK (TypeScript) project: own `package.json` +
  `package-lock.json`, `tsconfig.json`, `cdk.json`, `vitest.config.ts`.
  - `infra/lib/hosting-stack.ts`: private S3 bucket (`BLOCK_ALL` public access, S3-managed
    encryption, `enforceSSL`, `RETAIN` removal policy) + CloudFront distribution using the
    modern OAC (`S3BucketOrigin.withOriginAccessControl`, no legacy OAI), redirect-to-https,
    `defaultRootObject: index.html`, 403/404 → `index.html` (hash-router SPA rewrite), optional
    custom domain + ACM certificate (constructor throws if only one of
    `domainName`/`certificateArn` is given — the us-east-1 cert requirement is enforced/
    documented, not just assumed), `PriceClass_100`.
  - `infra/bin/windride.ts`: app entry; region defaults to `eu-north-1` (DEC-042); domain/cert
    come from CDK context, no hard-coded secrets.
  - `infra/test/hosting-stack.test.ts`: 6 offline CDK assertion tests (bucket privacy/
    encryption/SSL, CloudFront OAC wiring, SPA error responses, the domain/cert
    constructor-throws guard, etc.) — no AWS calls.
  - `infra/README.md`: manual bootstrap/deploy steps, least-privilege IAM policy, OIDC trust
    scoping guidance.
- `.github/workflows/deploy-aws.yml`: OIDC-based deploy (`id-token: write`, no long-lived AWS
  keys) — runs the lint + test + accept gate before build; builds with `VITE_BASE=/` and
  `VITE_LIVE_APIS=true` (live-but-keyless, no provider key ever set); syncs to S3 with a
  no-cache default, then re-stamps only hashed `assets/*` + `workbox-*.js` as
  `Cache-Control: immutable`; invalidates CloudFront for the entry points + `/data/*`.
- Isolation so the app's root gate never touches `infra/`: `eslint.config.js` now ignores
  `'infra'`, `.prettierignore` adds `infra`, `.gitignore` adds `cdk.out/` (`node_modules/` already
  covered). App-root `npm test`/`npm run lint`/`npm run build` stay green and unaware of `infra/`;
  `infra/` is gated by its own `cdk synth` + its 6 CDK assertion tests.

**Fable review — 3 findings, all fixed:**
1. Immutable `Cache-Control` was being applied to unhashed, mutable files — most importantly
   `data/exposure-uusimaa.json`, which would have been served with a long-lived immutable header
   and gone stale for up to a year. Fixed: everything syncs no-cache by default; only
   content-hashed `assets/*` + `workbox-*.js` get re-stamped immutable, and `/data/*` was added
   to the CloudFront invalidation path.
2. `infra/README.md`'s IAM guidance asked for `s3:*` on the bucket. Narrowed to least-privilege:
   `ListBucket` + `GetObject`/`PutObject`/`PutObjectAcl`/`DeleteObject` on `bucket/*`, plus
   `cloudfront:CreateInvalidation`; OIDC trust policy pinned to the specific repo +
   environment/ref rather than left open.
3. Passing `domainName` without `certificateArn` (or vice versa) would previously synth cleanly
   and fail mid-deploy. `HostingStack`'s constructor now throws immediately if exactly one of the
   two is set, with a test covering it.

Reviewer verified: bucket is genuinely private (no OAI, no public bucket policy, OAC-only);
deploy is OIDC-only (no AWS access keys anywhere, credentials configured only after
`npm ci`/build); the deployed app stays live-but-keyless; the us-east-1 ACM-cert requirement is
enforced at synth and documented; `git status` shows only the intended source files under
`infra/` (node_modules/ and cdk.out/ gitignored, confirmed not staged).

**Gate:** offline only, per CLAUDE.md rule 3 — no AWS account/credentials exist in this dev
environment. App root: 592 tests + lint + build all green. `infra/`: 6 CDK assertion tests +
`cdk synth` green, run independently of the app root gate.

**Decisions:** DEC-050 records the scaffold-now/deploy-later approach and the isolation
mechanism.

**Follow-up (manual, one-time, when AWS is provisioned):** bootstrap the CDK environment, set up
the OIDC provider + IAM role trust, and run `cdk deploy` — all documented in `infra/README.md`.
Live PWA/HTTPS/custom-domain/cache-invalidation smoke-testing (the story's Test contract) happens
at that point, not in this offline session.
