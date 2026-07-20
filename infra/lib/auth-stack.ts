import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

/**
 * WR-039 — free registration + login via Amazon Cognito. Email + password, self sign-up with email
 * verification, password reset. No forced MFA for v1. The web client is PUBLIC (no secret) and
 * enables USER_PASSWORD_AUTH so the browser can authenticate directly against Cognito with plain
 * fetch — no AWS SDK, no server proxy (the app stays backend-thin; BYO model). The user pool id +
 * client id are PUBLIC config (safe to bundle via VITE_ env), not secrets.
 *
 * OPEN (DEC-041): verify Cognito's current free-MAU tier before scaling; Supabase/Clerk are the
 * fallbacks behind the same client interface. Offline-verified by CDK assertions; deploy is manual.
 */
export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OFF, // no forced MFA for v1
      deletionProtection: true, // guard against accidental console/CLI deletion, not just CFN
      removalPolicy: RemovalPolicy.RETAIN, // never auto-delete the user directory
    });

    this.userPoolClient = this.userPool.addClient('WebClient', {
      generateSecret: false, // public SPA client — a browser can't keep a secret
      authFlows: { userPassword: true, userSrp: true },
      disableOAuth: true, // no hosted UI — the browser calls InitiateAuth directly (no callback URLs)
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, 'CognitoRegion', { value: this.region });
  }
}
