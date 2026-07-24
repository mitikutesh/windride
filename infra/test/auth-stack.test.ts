import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { AuthStack } from '../lib/auth-stack';

function synth() {
  const app = new App();
  const stack = new AuthStack(app, 'TestAuth', {
    env: { account: '111111111111', region: 'eu-north-1' },
  });
  return Template.fromStack(stack);
}

describe('AuthStack (WR-039)', () => {
  it('creates a self-sign-up email user pool with email verification and no forced MFA', () => {
    const t = synth();
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      AutoVerifiedAttributes: ['email'],
      UsernameAttributes: ['email'],
      MfaConfiguration: 'OFF',
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false }, // self sign-up enabled
    });
  });

  it('enforces a password policy', () => {
    synth().hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: {
        PasswordPolicy: Match.objectLike({
          MinimumLength: 8,
          RequireLowercase: true,
          RequireUppercase: true,
          RequireNumbers: true,
        }),
      },
    });
  });

  it('creates a PUBLIC web client (no secret) allowing password + refresh auth', () => {
    const t = synth();
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false, // public SPA client — no secret
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']),
      PreventUserExistenceErrors: 'ENABLED',
      AllowedOAuthFlows: Match.absent(), // hosted UI disabled — direct InitiateAuth only
    });
  });

  it('retains the user directory on stack deletion', () => {
    synth().hasResource('AWS::Cognito::UserPool', { DeletionPolicy: 'Retain' });
  });
});
