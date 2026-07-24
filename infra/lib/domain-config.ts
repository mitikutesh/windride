/**
 * Custom-domain context wiring (DEC-053). Pure — maps the four CDK context values
 * (domainName, certificateArn, hostedZoneId, hostedZoneName) onto per-stack props so
 * bin/windride.ts stays thin and this decision logic is unit-testable offline.
 *
 * Two-phase flow (README "Custom domain"): the cert must exist in us-east-1 BEFORE CloudFront
 * can use it, and its ARN is stable across ACM auto-renewals. So phase 1 (domain + zone, no
 * certificateArn) synthesizes ONLY the cert stack — hosting stays domainless with a synth-time
 * warning; phase 2 (all four values, baked into cdk.json) attaches the domain, cert, and
 * Route 53 alias records. crossRegionReferences was rejected — see DEC-053.
 */

export interface DomainContext {
  /** Site FQDN, e.g. "windride.mitikuteshome.com". */
  domainName?: string;
  /** us-east-1 ACM cert ARN (output of the WindRideCert stack, pasted into cdk.json once). */
  certificateArn?: string;
  /** Route 53 public hosted zone id of the parent zone (Route 53 console → Hosted zones). */
  hostedZoneId?: string;
  /** Parent zone name, e.g. "mitikuteshome.com" (no trailing dot). */
  hostedZoneName?: string;
}

export interface ResolvedDomainConfig {
  /** Props for the us-east-1 CertStack; absent when no zone is configured. */
  certStack?: { domainName: string; hostedZoneId: string; hostedZoneName: string };
  /** Domain-related props merged into HostingStack's props. */
  hosting: {
    domainName?: string;
    certificateArn?: string;
    dns?: { hostedZoneId: string; hostedZoneName: string };
  };
  /** Synth-time warning for the phase-1 window (cert requested but not yet wired in). */
  warning?: string;
}

/** Fail fast on a domain that DNS validation / alias records could never satisfy. */
export function assertDomainInZone(domainName: string, hostedZoneName: string): void {
  if (hostedZoneName.endsWith('.') || domainName.endsWith('.')) {
    throw new Error(
      `Domain names must not have a trailing dot (got "${domainName}" in zone "${hostedZoneName}").`,
    );
  }
  if (domainName !== hostedZoneName && !domainName.endsWith(`.${hostedZoneName}`)) {
    throw new Error(
      `domainName "${domainName}" is not inside hosted zone "${hostedZoneName}" — ` +
        'DNS validation and alias records would silently never resolve.',
    );
  }
}

export function resolveDomainConfig(ctx: DomainContext): ResolvedDomainConfig {
  const { domainName, certificateArn, hostedZoneId, hostedZoneName } = ctx;

  if (Boolean(hostedZoneId) !== Boolean(hostedZoneName)) {
    throw new Error('hostedZoneId and hostedZoneName must be provided together.');
  }
  const zone =
    hostedZoneId && hostedZoneName ? { hostedZoneId, hostedZoneName } : undefined;

  // A domain with no way to get a cert is always a mistake — refuse rather than silently
  // synthesizing a domainless site (which would strip the alias off a live distribution).
  if (domainName && !certificateArn && !zone) {
    throw new Error(
      `domainName "${domainName}" needs certificateArn, or hostedZoneId + hostedZoneName ` +
        'so the WindRideCert stack can create one (see infra/README.md "Custom domain").',
    );
  }
  if (domainName && zone) assertDomainInZone(domainName, zone.hostedZoneName);

  const certStack = domainName && zone ? { domainName, ...zone } : undefined;

  // The domain goes onto CloudFront only once the cert exists (phase 2). Passing certificateArn
  // through unconditionally preserves HostingStack's fail-fast "together" validation.
  const hosting: ResolvedDomainConfig['hosting'] = {
    domainName: certificateArn ? domainName : undefined,
    certificateArn,
    dns: certificateArn && domainName && zone ? zone : undefined,
  };

  const warning =
    certStack && !certificateArn
      ? `certificateArn not set — WindRideHosting synthesizes WITHOUT ${certStack.domainName}. ` +
        'Deploy WindRideCert, then add its CertificateArn output to cdk.json context (README "Custom domain").'
      : undefined;

  return { certStack, hosting, warning };
}
