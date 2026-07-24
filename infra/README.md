# WindRide infrastructure (AWS CDK)

Isolated AWS CDK (TypeScript) project for WindRide's cloud (Epic 5). Self-contained: its own
`package.json`, `tsconfig.json`, and Vitest — the app's root `npm test`/`lint`/`build` never touch
it, and it never touches the app.

- **WR-037** `HostingStack` — S3 (private, OAC) + CloudFront + optional custom domain/ACM cert
  + Route 53 alias records (DEC-053).
- **WR-038** `BackendStack` — one Node Lambda behind a Function URL + a DynamoDB single table.
- **DEC-053** `CertStack` — us-east-1 ACM certificate for the custom domain (CloudFront requires
  certs from us-east-1), DNS-validated automatically in the Route 53 zone.

> **The Function URL is PUBLIC** (`authType: NONE` — no platform auth). The skeleton only serves
> `GET /health`. Every authenticated route added later (WR-040 `/me`, WR-041 sync) **MUST verify
> the Cognito JWT inside the handler** — there is no gateway doing it. The single-table key design
> (`PK=USER#<sub>`, `SK` per record type; one partition per user) is documented in
> `lib/backend-stack.ts`.

Region defaults to **eu-north-1** (Stockholm, EU data residency). CloudFront is global; a custom
domain's ACM certificate **must** be in **us-east-1**.

## Verify (offline, no AWS account needed)

```bash
cd infra
npm install
npm test        # CDK assertion tests (Template.fromStack) — no credentials, no network
npm run synth   # synthesize CloudFormation locally
```

These are the CI-safe checks. Everything below needs the owner's AWS credentials and is **manual**.

## One-time setup (owner, with AWS credentials)

1. **Bootstrap** the account/region once: `npx cdk bootstrap aws://<account>/eu-north-1`.
2. **Deploy the hosting stack:** `npx cdk deploy WindRideHosting` — with no domain configured you
   get a `*.cloudfront.net` URL. Add the custom domain later (next section) without a replacement.

   Then deploy the backend (after hosting — it references the CloudFront domain for CORS):
   ```bash
   npx cdk deploy WindRideBackend
   ```
   Smoke-test the health endpoint from the `ApiUrl` stack output:
   ```bash
   curl "$API_URL/health"   # → {"status":"ok","version":"dev"}
   ```
4. **OIDC deploy role:** create an IAM role trusting GitHub's OIDC provider
   (`token.actions.githubusercontent.com`). No long-lived keys. Scope it tightly:
   - **Trust:** pin the `sub` claim to this repo AND a single ref/environment, e.g.
     `repo:<owner>/windride:environment:production` (or `:ref:refs/heads/main`) — repo-wide trust
     would let any branch's workflow assume the role.
   - **Least-privilege permissions** (exactly what `s3 sync --delete` + `cp` + invalidation need —
     NOT `s3:*`, which would let a compromised pipeline flip off public-access-block, attach a
     public bucket policy, or delete the bucket):
     - `s3:ListBucket` on `arn:aws:s3:::<site-bucket>`
     - `s3:GetObject`, `s3:PutObject`, `s3:PutObjectAcl`, `s3:DeleteObject` on
       `arn:aws:s3:::<site-bucket>/*`
     - `cloudfront:CreateInvalidation` on the distribution ARN
5. **GitHub config** for `.github/workflows/deploy-aws.yml`:
   - Secret `AWS_DEPLOY_ROLE_ARN` — the OIDC role ARN.
   - Variables `AWS_REGION`, `SITE_BUCKET` (stack output `SiteBucketName`),
     `CLOUDFRONT_DISTRIBUTION_ID` (stack output `DistributionId`).

Then run the **Deploy to AWS** workflow (manual dispatch), or uncomment its `push` trigger.

## Custom domain (windride.mitikuteshome.com, DEC-053)

CDK creates and DNS-validates the ACM cert (`CertStack`, us-east-1) and the Route 53 alias
records (`HostingStack`). Two-phase because CloudFront can only attach a cert that already
exists — the cert's ARN is **stable across ACM auto-renewals**, so the handoff happens once.

0. **Preflight — verify NS delegation** (a wrong zone makes the cert validation hang for hours):
   ```bash
   dig +short NS mitikuteshome.com
   ```
   must return the same 4 name servers listed on the hosted zone in the Route 53 console.
   Copy the zone's **Hosted zone ID** (`Z…`) from that console page.
1. **Bootstrap us-east-1** once (step 1 above only bootstrapped eu-north-1; the cert stack
   deploys to us-east-1): `npx cdk bootstrap aws://<account>/us-east-1`.
2. **Deploy the cert** (phase 1 — hosting intentionally stays domainless with a synth warning):
   ```bash
   npx cdk deploy WindRideCert \
     -c domainName=windride.mitikuteshome.com \
     -c hostedZoneId=<Z… from the Route 53 console> \
     -c hostedZoneName=mitikuteshome.com
   ```
   The deploy waits for DNS validation (a few minutes) and outputs `CertificateArn`.
3. **Bake the config** (phase 2) — add all four values to `cdk.json` `"context"` so every future
   deploy keeps the domain with zero flags (forgetting `-c` flags would otherwise silently strip
   the live alias):
   ```json
   "domainName": "windride.mitikuteshome.com",
   "hostedZoneId": "<Z… from the Route 53 console>",
   "hostedZoneName": "mitikuteshome.com",
   "certificateArn": "<CertificateArn output from step 2>"
   ```
4. **Deploy everything:** `npx cdk deploy --all` — attaches the alias + cert to the existing
   distribution **in place** (same distribution, same `DistributionId`), creates the A/AAAA
   alias records, and adds `https://windride.mitikuteshome.com` to the backend's CORS origins.

Notes:
- The old `*.cloudfront.net` URL keeps working. IndexedDB is **per-origin**, so on the new
  domain you re-enter your API keys (Kit → API keys) once; saved routes/prefs follow via
  account sync (WR-041) after signing in.
- A manually-created cert still works: set only `domainName` + `certificateArn` (no zone
  values) — then no Route 53 records are managed and you point DNS yourself.
- Teardown order: destroy `WindRideHosting` (or remove the domain config and redeploy) before
  `WindRideCert` — CloudFront holds the cert in use.
- Rollback: remove the four context values, `npx cdk deploy --all` — alias and records are
  removed in place; the distribution and site keep serving on `*.cloudfront.net`.

## Notes

- No secrets/keys live in this project or the workflow — the app is deployed live-but-keyless
  (DEC-036); every visitor supplies their own API keys in the browser.
- `RemovalPolicy.RETAIN` on the site bucket: destroying the stack never deletes the bucket.
