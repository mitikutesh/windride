# WR-037 · AWS static hosting + custom domain
Epic: 5 · Accounts | Status: TODO | Depends on: — | Size: M

## Goal
Move the deployed PWA from GitHub Pages to S3 + CloudFront under a custom HTTPS domain — the
stable home the accounts era needs (Cognito callbacks, a privacy-policy URL, no `/windride/`
subpath contortions).

## Context (read first)
DECISIONS DEC-036 (Pages deploy — this supersedes its hosting half) · DEC-039 · CLAUDE.md
golden rule 6 (secrets).

## Acceptance criteria
- [ ] Private S3 bucket (CloudFront OAC only, no public access) + CloudFront distribution +
      ACM certificate (issued in **us-east-1** — CloudFront requires it) serving the app over
      HTTPS on the custom domain; default root object `index.html`.
- [ ] Cache policy: hashed `assets/*` long-lived + immutable; `index.html`, `sw.js`,
      `manifest.webmanifest` no-cache (or short TTL) **plus** a CloudFront invalidation on
      deploy — a stale service worker must never pin an old app.
- [ ] Build with `VITE_BASE=/` and `VITE_LIVE_APIS=true`; PWA scope/`start_url`/SW verified at
      the domain root (the DEC-036 subpath accommodations keep working locally, unused here).
- [ ] GitHub Actions deploy authenticates via an **OIDC-assumed IAM role** — no long-lived AWS
      keys in repo secrets; the lint + test + accept gate still runs before publish (DEC-036).
- [ ] No key is baked: the workflow never sets `VITE_ORS_API_KEY` etc.; the deployed app stays
      live-but-keyless (DEC-034/DEC-036) until a user brings keys.

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
