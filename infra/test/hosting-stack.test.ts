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
});
