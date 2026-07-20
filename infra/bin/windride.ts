#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { HostingStack } from '../lib/hosting-stack';

// Config comes from CDK context (‑c key=value) or env — never hard-coded secrets. Region defaults
// to eu-north-1 (Stockholm) for EU data residency; CloudFront is global and the ACM cert for a
// custom domain must live in us-east-1 (pass its ARN via -c certificateArn=...).
const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'eu-north-1',
};

new HostingStack(app, 'WindRideHosting', {
  env,
  domainName: app.node.tryGetContext('domainName'),
  certificateArn: app.node.tryGetContext('certificateArn'),
});
