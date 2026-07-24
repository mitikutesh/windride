import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';
import { assertDomainInZone } from './domain-config';

export interface CertStackProps extends StackProps {
  /** Site FQDN the cert covers, e.g. "windride.mitikuteshome.com". */
  domainName: string;
  /** Route 53 public hosted zone id of the parent zone (Route 53 console → Hosted zones). */
  hostedZoneId: string;
  /** Parent zone name, e.g. "mitikuteshome.com" (no trailing dot). */
  hostedZoneName: string;
}

/**
 * DEC-053 — ACM certificate for the CloudFront custom domain. CloudFront only accepts certs
 * from us-east-1, so this lives in its own stack there (the app stacks are eu-north-1).
 * DNS validation records are created automatically in the hosted zone, and ACM auto-renews
 * the cert WITHOUT changing its ARN — so the ARN is pasted into cdk.json context exactly once
 * (the `CertificateArn` output) and consumed by HostingStack's existing certificateArn path.
 * No crossRegionReferences: experimental, adds SSM-export custom resources and deletion-order
 * coupling for what is a one-time 30-second handoff on a manually-deployed app.
 *
 * Zone comes from explicit attributes (never fromLookup) so synth and tests stay offline.
 * Teardown: destroy WindRideHosting first — CloudFront holds the cert in use.
 */
export class CertStack extends Stack {
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: CertStackProps) {
    super(scope, id, props);

    // Fail fast at synth on the two mistakes that otherwise hang the deploy for hours:
    // a cert CloudFront can't use (wrong region) or validation records in a zone that isn't
    // authoritative for the domain.
    if (this.region !== 'us-east-1') {
      throw new Error(
        `CertStack must be deployed to us-east-1 (CloudFront requirement), got "${this.region}".`,
      );
    }
    assertDomainInZone(props.domainName, props.hostedZoneName);

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'SiteZone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.hostedZoneName,
    });

    this.certificate = new acm.Certificate(this, 'SiteCert', {
      domainName: props.domainName,
      // Passing the zone is what makes validation hands-off: CDK writes the validation CNAME
      // into it and the deploy waits for ISSUED. fromDns() without a zone would hang forever.
      validation: acm.CertificateValidation.fromDns(zone),
    });

    new CfnOutput(this, 'CertificateArn', {
      value: this.certificate.certificateArn,
      description: 'Paste into infra/cdk.json context as "certificateArn" (stable across renewals).',
    });
  }
}
