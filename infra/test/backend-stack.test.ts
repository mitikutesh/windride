import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { BackendStack } from '../lib/backend-stack';

function synth() {
  const app = new App();
  const stack = new BackendStack(app, 'TestBackend', {
    env: { account: '111111111111', region: 'eu-north-1' },
    allowedOrigins: ['https://windride.example.com'],
    cognito: {
      userPoolId: 'eu-north-1_test',
      clientId: 'client1',
      region: 'eu-north-1',
      userPoolArn: 'arn:aws:cognito-idp:eu-north-1:111111111111:userpool/eu-north-1_test',
    },
  });
  return Template.fromStack(stack);
}

describe('BackendStack (WR-038)', () => {
  it('creates an on-demand, encrypted, PITR DynamoDB single table (PK/SK), retained', () => {
    const t = synth();
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      SSESpecification: { SSEEnabled: true },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      KeySchema: Match.arrayWith([
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ]),
    });
    t.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain' });
  });

  it('runs a Node 22 Lambda behind a public Function URL (no API Gateway)', () => {
    const t = synth();
    t.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Environment: Match.objectLike({
        Variables: Match.objectLike({ COGNITO_USER_POOL_ID: 'eu-north-1_test' }),
      }),
    });
    t.resourceCountIs('AWS::Lambda::Url', 1);
    t.hasResourceProperties('AWS::Lambda::Url', {
      AuthType: 'NONE',
      Cors: Match.objectLike({ AllowOrigins: Match.arrayWith(['https://windride.example.com']) }),
    });
    t.resourceCountIs('AWS::ApiGateway::RestApi', 0); // Function URL, not API Gateway
  });

  it('grants the Lambda read/write on ONLY its own table (positively: no wildcard resource)', () => {
    const t = synth();
    // Inspect the synthesized policies directly — a positive check that every dynamodb statement's
    // Resource points at OUR table (Fn::GetAtt DataTable...) and never contains a "*" wildcard.
    const policies = t.findResources('AWS::IAM::Policy');
    type Stmt = { Action?: unknown; Resource?: unknown };
    const statements = Object.values(policies).flatMap(
      (p) => (p.Properties as { PolicyDocument: { Statement: Stmt[] } }).PolicyDocument.Statement,
    );
    const dynamoStmts = statements.filter((s) => JSON.stringify(s.Action).includes('dynamodb:'));
    expect(dynamoStmts.length).toBeGreaterThan(0);
    for (const s of dynamoStmts) {
      const res = JSON.stringify(s.Resource);
      expect(res).toContain('DataTable'); // scoped to our table's GetAtt ARN
      expect(res).not.toContain('"*"'); // never a wildcard resource
    }
  });

  it('grants ONLY cognito-idp:AdminDeleteUser on the pool (GDPR erasure, WR-042)', () => {
    const t = synth();
    const policies = t.findResources('AWS::IAM::Policy');
    type Stmt = { Action?: unknown; Resource?: unknown };
    const statements = Object.values(policies).flatMap(
      (p) => (p.Properties as { PolicyDocument: { Statement: Stmt[] } }).PolicyDocument.Statement,
    );
    const cognitoStmts = statements.filter((s) => JSON.stringify(s.Action).includes('cognito-idp'));
    expect(cognitoStmts.length).toBe(1);
    expect(JSON.stringify(cognitoStmts[0].Action)).toBe('"cognito-idp:AdminDeleteUser"');
    expect(JSON.stringify(cognitoStmts[0].Resource)).toContain('userpool/eu-north-1_test');
  });
});
