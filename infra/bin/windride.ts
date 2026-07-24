#!/usr/bin/env node
import { Annotations, App } from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack';
import { BackendStack } from '../lib/backend-stack';
import { CertStack } from '../lib/cert-stack';
import { resolveDomainConfig } from '../lib/domain-config';
import { HostingStack } from '../lib/hosting-stack';

// Config comes from CDK context (‑c key=value or cdk.json) — never hard-coded secrets. Region
// defaults to eu-north-1 (Stockholm) for EU data residency; CloudFront is global and the ACM cert
// for a custom domain must live in us-east-1, so it gets its own stack there (DEC-053; see
// README "Custom domain" for the two-phase flow).
const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'eu-north-1',
};

const domainName: string | undefined = app.node.tryGetContext('domainName');

const domain = resolveDomainConfig({
  domainName,
  certificateArn: app.node.tryGetContext('certificateArn'),
  hostedZoneId: app.node.tryGetContext('hostedZoneId'),
  hostedZoneName: app.node.tryGetContext('hostedZoneName'),
});

if (domain.certStack) {
  const cert = new CertStack(app, 'WindRideCert', {
    env: { account: env.account, region: 'us-east-1' }, // CloudFront-mandated cert region
    ...domain.certStack,
  });
  if (domain.warning) {
    Annotations.of(cert).addWarningV2('windride:domain-pending', domain.warning);
  }
}

const hosting = new HostingStack(app, 'WindRideHosting', {
  env,
  ...domain.hosting,
});

const auth = new AuthStack(app, 'WindRideAuth', { env });

new BackendStack(app, 'WindRideBackend', {
  env,
  // Let the deployed site call the API — the custom domain (if any) AND the CloudFront domain, so
  // the default (no-custom-domain) deploy still works. localhost is added inside the stack for dev.
  allowedOrigins: [
    ...(domainName ? [`https://${domainName}`] : []),
    `https://${hosting.distributionDomainName}`,
  ],
  buildVersion: app.node.tryGetContext('buildVersion'),
  cognito: {
    userPoolId: auth.userPool.userPoolId,
    clientId: auth.userPoolClient.userPoolClientId,
    region: env.region,
    userPoolArn: auth.userPool.userPoolArn,
  },
});
