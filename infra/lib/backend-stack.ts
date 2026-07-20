import * as path from 'path';
import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';

export interface BackendStackProps extends StackProps {
  /** Origins allowed to call the Function URL (the site domain(s)); localhost is added for dev. */
  allowedOrigins?: string[];
  /** Build version surfaced by GET /health. */
  buildVersion?: string;
  /** Cognito pool config so the Lambda can verify JWTs (WR-040) + delete the user on erasure (WR-042). */
  cognito?: { userPoolId: string; clientId: string; region: string; userPoolArn?: string };
}

/**
 * WR-038 — the thin backend skeleton. One Lambda (Node) behind a Function URL (no API Gateway, to
 * avoid its per-request cost) and a DynamoDB SINGLE table. Region comes from the app env (eu-north-1
 * default, DEC-042). Least-privilege: the function gets read/write on ONLY this one table. No
 * secrets in code. Verified offline by CDK assertions + a handler unit test; `cdk deploy` is manual.
 *
 * Single-table key design (documented for WR-040/041):
 *   PK = "USER#<cognito-sub>"      SK = "PROFILE" | "ROUTE#<id>" | "PREF#<key>" | ...
 *   One partition per user; item type is the SK prefix. No cross-user access path exists.
 */
export class BackendStack extends Stack {
  readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: BackendStackProps = {}) {
    super(scope, id, props);

    this.table = new dynamodb.Table(this, 'DataTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // on-demand — ~free at low volume
      encryption: dynamodb.TableEncryption.AWS_MANAGED, // KMS-backed encryption at rest (DEC-042)
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN, // never auto-delete user data
    });

    const api = new lambda.Function(this, 'ApiFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda')),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.table.tableName,
        BUILD_VERSION: props.buildVersion ?? 'dev',
        // JWT verification config (WR-040) — public identifiers, not secrets.
        COGNITO_USER_POOL_ID: props.cognito?.userPoolId ?? '',
        COGNITO_CLIENT_ID: props.cognito?.clientId ?? '',
        COGNITO_REGION: props.cognito?.region ?? '',
      },
    });
    // Least privilege: only this table, only read/write (no admin, no wildcard resource).
    this.table.grantReadWriteData(api);

    // GDPR erasure (WR-042): allow deleting a Cognito user — ONLY that action, ONLY this pool.
    if (props.cognito?.userPoolArn) {
      api.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['cognito-idp:AdminDeleteUser'],
          resources: [props.cognito.userPoolArn],
        }),
      );
    }

    const fnUrl = api.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // health is public; auth'd routes verify JWT in-handler
      cors: {
        allowedOrigins: [...(props.allowedOrigins ?? []), 'http://localhost:5173'],
        allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST, lambda.HttpMethod.DELETE],
        allowedHeaders: ['authorization', 'content-type'],
      },
    });

    new CfnOutput(this, 'ApiUrl', { value: fnUrl.url });
    new CfnOutput(this, 'DataTableName', { value: this.table.tableName });
  }
}
