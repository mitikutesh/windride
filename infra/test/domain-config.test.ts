import { describe, expect, it } from 'vitest';
import { resolveDomainConfig } from '../lib/domain-config';

const DOMAIN = 'windride.example.com';
const ARN = 'arn:aws:acm:us-east-1:111111111111:certificate/abc';
const ZONE = { hostedZoneId: 'Z0123456789ABCDEFGHIJ', hostedZoneName: 'example.com' };

describe('resolveDomainConfig (DEC-053 context wiring)', () => {
  it('no context => no cert stack, domainless hosting (the default offline synth)', () => {
    const r = resolveDomainConfig({});
    expect(r.certStack).toBeUndefined();
    expect(r.hosting).toEqual({ domainName: undefined, certificateArn: undefined, dns: undefined });
    expect(r.warning).toBeUndefined();
  });

  it('legacy path: domainName + certificateArn (no zone) => hosting only, no records', () => {
    const r = resolveDomainConfig({ domainName: DOMAIN, certificateArn: ARN });
    expect(r.certStack).toBeUndefined();
    expect(r.hosting).toEqual({ domainName: DOMAIN, certificateArn: ARN, dns: undefined });
  });

  it('phase 1 (bootstrap): domain + zone, no ARN => cert stack only, hosting domainless + warning', () => {
    const r = resolveDomainConfig({ domainName: DOMAIN, ...ZONE });
    expect(r.certStack).toEqual({ domainName: DOMAIN, ...ZONE });
    // The domain must NOT reach HostingStack yet — its "together" validation would reject it,
    // and CloudFront could not attach a cert that does not exist.
    expect(r.hosting.domainName).toBeUndefined();
    expect(r.hosting.dns).toBeUndefined();
    expect(r.warning).toMatch(/certificateArn not set/);
  });

  it('phase 2 (steady state): all four values => cert stack kept + full hosting wiring', () => {
    const r = resolveDomainConfig({ domainName: DOMAIN, certificateArn: ARN, ...ZONE });
    // Cert stack stays in the app so the cert remains managed (renewal, teardown).
    expect(r.certStack).toEqual({ domainName: DOMAIN, ...ZONE });
    expect(r.hosting).toEqual({ domainName: DOMAIN, certificateArn: ARN, dns: ZONE });
    expect(r.warning).toBeUndefined();
  });

  it('refuses a domain with no cert source (would strip the alias off a live distribution)', () => {
    expect(() => resolveDomainConfig({ domainName: DOMAIN })).toThrow(/needs certificateArn/);
  });

  it('refuses half a zone or a domain outside the zone', () => {
    expect(() =>
      resolveDomainConfig({ domainName: DOMAIN, hostedZoneId: ZONE.hostedZoneId }),
    ).toThrow(/together/);
    expect(() =>
      resolveDomainConfig({ domainName: 'windride.other.com', certificateArn: ARN, ...ZONE }),
    ).toThrow(/not inside hosted zone/);
  });
});
