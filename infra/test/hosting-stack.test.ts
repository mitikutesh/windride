import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { HostingStack } from '../lib/hosting-stack';

function synth(props = {}) {
  const app = new App();
  const stack = new HostingStack(app, 'Test', {
    env: { account: '111111111111', region: 'eu-north-1' },
    ...props,
  });
  return Template.fromStack(stack);
}

describe('HostingStack (WR-037)', () => {
  it('creates a private, encrypted, SSL-enforced S3 bucket (no public reads)', () => {
    const t = synth();
    t.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    // enforceSSL adds a bucket policy denying non-TLS access.
    t.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
        ]),
      }),
    });
  });

  it('serves index.html over HTTPS via CloudFront', () => {
    synth().hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
      }),
    });
  });

  it('maps SPA 403/404 to index.html for the hash router', () => {
    synth().hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' }),
        ]),
      }),
    });
  });

  it('reads the bucket privately via Origin Access Control (no legacy OAI, no public bucket)', () => {
    const t = synth();
    t.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    t.resourceCountIs('AWS::CloudFront::CloudFrontOriginAccessIdentity', 0);
  });

  it('fails fast if a domain is given without a certificate (or vice-versa)', () => {
    expect(() => synth({ domainName: 'windride.example.com' })).toThrow(/together/);
    expect(() =>
      synth({ certificateArn: 'arn:aws:acm:us-east-1:111111111111:certificate/abc' }),
    ).toThrow(/together/);
  });

  it('attaches a custom domain + certificate only when both are supplied', () => {
    synth({
      domainName: 'windride.example.com',
      certificateArn: 'arn:aws:acm:us-east-1:111111111111:certificate/abc',
    }).hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: ['windride.example.com'] }),
    });
    // Without a domain, no Aliases are set.
    const plain = synth();
    plain.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: Match.absent() }),
    });
  });

  // --- Custom domain DNS + viewer hardening (DEC-053) ---

  const DOMAIN = 'windride.example.com';
  const CERT = 'arn:aws:acm:us-east-1:111111111111:certificate/abc';
  const DNS = { hostedZoneId: 'Z0123456789ABCDEFGHIJ', hostedZoneName: 'example.com' };

  it('creates A + AAAA alias records to the distribution when dns is configured', () => {
    const t = synth({ domainName: DOMAIN, certificateArn: CERT, dns: DNS });
    for (const type of ['A', 'AAAA']) {
      t.hasResourceProperties('AWS::Route53::RecordSet', {
        Type: type,
        Name: `${DOMAIN}.`,
        HostedZoneId: DNS.hostedZoneId,
        // The GetAtt proves the alias points at THIS distribution, not some hardcoded name.
        AliasTarget: Match.objectLike({
          DNSName: { 'Fn::GetAtt': [Match.stringLikeRegexp('^Cdn'), 'DomainName'] },
        }),
      });
    }
    // CDK resolves the CloudFront alias zone via a partition map; the aws partition must be
    // Z2FDTNDATAQYW2 (CloudFront's fixed alias hosted zone — anything else never resolves).
    t.hasMapping('AWSCloudFrontPartitionHostedZoneIdMap', { aws: { zoneId: 'Z2FDTNDATAQYW2' } });
    t.resourceCountIs('AWS::Route53::RecordSet', 2);
    // No dns prop => no records (the legacy manual-DNS path).
    synth({ domainName: DOMAIN, certificateArn: CERT }).resourceCountIs(
      'AWS::Route53::RecordSet',
      0,
    );
  });

  it('fails fast on dns without a domain, or a domain outside the zone', () => {
    expect(() => synth({ dns: DNS })).toThrow(/dns requires domainName/);
    expect(() =>
      synth({ domainName: 'windride.other.com', certificateArn: CERT, dns: DNS }),
    ).toThrow(/not inside hosted zone/);
  });

  it('pins TLSv1.2_2021 when a custom certificate is attached', () => {
    synth({ domainName: DOMAIN, certificateArn: CERT }).hasResourceProperties(
      'AWS::CloudFront::Distribution',
      {
        DistributionConfig: Match.objectLike({
          ViewerCertificate: Match.objectLike({
            AcmCertificateArn: CERT,
            MinimumProtocolVersion: 'TLSv1.2_2021',
            SslSupportMethod: 'sni-only',
          }),
        }),
      },
    );
  });

  it('attaches the managed security-headers policy (HSTS et al.)', () => {
    synth().hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ResponseHeadersPolicyId: Match.anyValue(),
        }),
      }),
    });
  });

  it('keeps the distribution logical id stable across domain variants (in-place update, never a replacement)', () => {
    // Replacement would mint a new *.cloudfront.net domain, orphaning the CI vars
    // (CLOUDFRONT_DISTRIBUTION_ID) and production DNS — the worst realistic failure here.
    const idOf = (t: Template) => Object.keys(t.findResources('AWS::CloudFront::Distribution'))[0];
    const plain = idOf(synth());
    const withDomain = idOf(synth({ domainName: DOMAIN, certificateArn: CERT, dns: DNS }));
    expect(plain).toBeTruthy();
    expect(withDomain).toBe(plain);
  });
});
