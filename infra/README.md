# WindRide infrastructure (AWS CDK)

Isolated AWS CDK (TypeScript) project for WindRide's cloud (Epic 5). Self-contained: its own
`package.json`, `tsconfig.json`, and Vitest — the app's root `npm test`/`lint`/`build` never touch
it, and it never touches the app.

- **WR-037** `HostingStack` — S3 (private, OAC) + CloudFront + optional custom domain/ACM cert.
- **WR-038** `BackendStack` — one Node Lambda behind a Function URL + a DynamoDB single table.

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
2. **Custom domain (optional):** request an ACM certificate for your domain **in us-east-1**, and
   validate it (DNS). Note its ARN.
3. **Deploy the hosting stack:**
   ```bash
   npx cdk deploy WindRideHosting \
     -c domainName=windride.example.com \
     -c certificateArn=arn:aws:acm:us-east-1:<account>:certificate/<id>
   ```
   (Omit both `-c` flags to deploy without a custom domain — you'll get a `*.cloudfront.net` URL.)
   If using a custom domain, point its DNS (Route 53 alias or a CNAME) at the CloudFront domain from
   the stack outputs.

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

## Notes

- No secrets/keys live in this project or the workflow — the app is deployed live-but-keyless
  (DEC-036); every visitor supplies their own API keys in the browser.
- `RemovalPolicy.RETAIN` on the site bucket: destroying the stack never deletes the bucket.

## One-click console setup (no CLI needed)

`infra/oneclick-hosting-oidc.template.json` is a standalone CloudFormation template — the
synthesized `WindRideHosting` stack (S3 + CloudFront/OAC) plus the GitHub OIDC provider and the
least-privilege `windride-github-deploy` role (trust pinned to
`repo:mitikutesh/windride:environment:production`, matching `deploy-aws.yml`'s job environment).
Upload it in the AWS Console → CloudFormation → Create stack (region eu-north-1), then copy the
stack Outputs into the GitHub secret/variables listed above. If the account already has the
GitHub OIDC provider, set the `CreateOidcProvider` parameter to `false`.
