import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { assertDomainInZone } from './domain-config';

export interface HostingStackProps extends StackProps {
  /** Custom domain, e.g. "windride.example.com" (optional — falls back to the CloudFront domain). */
  domainName?: string;
  /** ACM certificate ARN for `domainName`. MUST be in us-east-1 (CloudFront requirement). */
  certificateArn?: string;
  /** Route 53 zone of `domainName`'s parent — set to also create alias A/AAAA records (DEC-053).
   *  Explicit attributes (never fromLookup) so synth and tests stay offline. */
  dns?: { hostedZoneId: string; hostedZoneName: string };
}

/**
 * WR-037 — static hosting for the WindRide PWA: a PRIVATE S3 bucket (Origin Access Control, no
 * public reads) behind a CloudFront distribution over HTTPS, optionally on a custom domain. The
 * hash-router SPA maps 403/404 → index.html. Cache behaviour is set at upload time by the deploy
 * workflow (immutable hashed assets vs. no-cache index.html/sw.js + invalidation), not here.
 *
 * No secrets, no keys — the deployed app is live-but-keyless; every visitor brings their own
 * (DEC-036). Deploy is GitHub-Actions + OIDC (see .github/workflows/deploy-aws.yml); this stack is
 * verified offline by CDK assertions (infra/test) — `cdk deploy` needs the owner's AWS credentials.
 */
export class HostingStack extends Stack {
  readonly bucketName: string;
  /** The CloudFront domain (e.g. d123.cloudfront.net) — the backend allows it as a CORS origin. */
  readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props: HostingStackProps = {}) {
    super(scope, id, props);

    // A custom domain needs its cert and vice-versa: a domain without a cert synths fine but fails
    // mid-deploy (CloudFront InvalidViewerCertificate). Fail fast + clearly instead.
    if (Boolean(props.domainName) !== Boolean(props.certificateArn)) {
      throw new Error(
        'HostingStack: domainName and certificateArn must be provided together (the ACM cert must live in us-east-1).',
      );
    }
    // Alias records need a domain, and the domain must actually live inside the zone —
    // otherwise the records synth fine but can never resolve.
    if (props.dns) {
      if (!props.domainName) {
        throw new Error('HostingStack: dns requires domainName (nothing to point the records at).');
      }
      assertDomainInZone(props.domainName, props.dns.hostedZoneName);
    }

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // private; CloudFront reads via OAC
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN, // never auto-delete the site bucket
    });
    this.bucketName = bucket.bucketName;

    const certificate = props.certificateArn
      ? acm.Certificate.fromCertificateArn(this, 'SiteCert', props.certificateArn)
      : undefined;

    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        // Managed security headers (HSTS, nosniff, frame/referrer policy). No CSP — safe for the PWA.
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      domainNames: props.domainName ? [props.domainName] : undefined,
      certificate,
      // Without the cdk.json feature flag, CDK still defaults a custom-cert distribution to the
      // weaker TLSv1.2_2019 policy — pin the 2021 one explicitly (only valid with a custom cert).
      minimumProtocolVersion: certificate
        ? cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021
        : undefined,
      // SPA hash-router: unknown paths (and OAC 403s for missing keys) resolve to index.html.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.seconds(0),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // NA + EU edges — cheapest, covers Nordics
    });

    this.distributionDomainName = distribution.distributionDomainName;

    // DEC-053: alias records live here (same stack as the distribution — no cross-stack,
    // cross-region reference needed). A + AAAA because the distribution serves IPv6 by default.
    if (props.dns && props.domainName) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'SiteZone', {
        hostedZoneId: props.dns.hostedZoneId,
        zoneName: props.dns.hostedZoneName,
      });
      const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
      new route53.ARecord(this, 'SiteAliasA', {
        zone,
        recordName: props.domainName,
        target,
        comment: 'WindRide PWA -> CloudFront (managed by WindRideHosting)',
      });
      new route53.AaaaRecord(this, 'SiteAliasAaaa', {
        zone,
        recordName: props.domainName,
        target,
        comment: 'WindRide PWA -> CloudFront (managed by WindRideHosting)',
      });
    }

    new CfnOutput(this, 'SiteBucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'DistributionDomainName', { value: distribution.distributionDomainName });
  }
}
