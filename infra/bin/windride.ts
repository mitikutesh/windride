#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack';
import { BackendStack } from '../lib/backend-stack';
import { HostingStack } from '../lib/hosting-stack';

// Config comes from CDK context (‑c key=value) or env — never hard-coded secrets. Region defaults
// to eu-north-1 (Stockholm) for EU data residency; CloudFront is global and the ACM cert for a
// custom domain must live in us-east-1 (pass its ARN via -c certificateArn=...).
const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'eu-north-1',
};

const domainName: string | undefined = app.node.tryGetContext('domainName');

const hosting = new HostingStack(app, 'WindRideHosting', {
  env,
  domainName,
  certificateArn: app.node.tryGetContext('certificateArn'),
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
  },
});
