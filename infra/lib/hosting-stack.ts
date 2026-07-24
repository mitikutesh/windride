import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export interface HostingStackProps extends StackProps {
  /** Custom domain, e.g. "windride.example.com" (optional — falls back to the CloudFront domain). */
  domainName?: string;
  /** ACM certificate ARN for `domainName`. MUST be in us-east-1 (CloudFront requirement). */
  certificateArn?: string;
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
      },
      domainNames: props.domainName ? [props.domainName] : undefined,
      certificate,
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

    new CfnOutput(this, 'SiteBucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'DistributionDomainName', { value: distribution.distributionDomainName });
  }
}
