import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { CertStack } from '../lib/cert-stack';

function synth(props = {}) {
  const app = new App();
  const stack = new CertStack(app, 'TestCert', {
    env: { account: '111111111111', region: 'us-east-1' },
    domainName: 'windride.example.com',
    hostedZoneId: 'Z0123456789ABCDEFGHIJ',
    hostedZoneName: 'example.com',
    ...props,
  });
  return Template.fromStack(stack);
}

describe('CertStack (DEC-053)', () => {
  it('creates a DNS-validated certificate whose validation record lands in the given zone', () => {
    // HostedZoneId in DomainValidationOptions is what makes validation hands-off: without it
    // (fromDns() with no zone) the deploy synths fine but hangs forever waiting for a record
    // nobody creates. This assertion guards the likeliest silent failure.
    synth().hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'windride.example.com',
      ValidationMethod: 'DNS',
      DomainValidationOptions: [
        { DomainName: 'windride.example.com', HostedZoneId: 'Z0123456789ABCDEFGHIJ' },
      ],
    });
  });

  it('outputs the certificate ARN (the value pasted into cdk.json context once)', () => {
    synth().hasOutput('CertificateArn', {});
  });

  it('fails fast outside us-east-1 (CloudFront would reject the cert mid-deploy)', () => {
    expect(() => synth({ env: { account: '111111111111', region: 'eu-north-1' } })).toThrow(
      /us-east-1/,
    );
  });

  it('fails fast when the domain is not inside the hosted zone', () => {
    expect(() => synth({ domainName: 'windride.other.com' })).toThrow(/not inside hosted zone/);
    // "evil-example.com".endsWith("example.com") — the guard must require a dot boundary.
    expect(() => synth({ domainName: 'evil-example.com' })).toThrow(/not inside hosted zone/);
  });

  it('rejects trailing-dot zone/domain names (would defeat the containment check)', () => {
    expect(() => synth({ hostedZoneName: 'example.com.' })).toThrow(/trailing dot/);
  });
});
