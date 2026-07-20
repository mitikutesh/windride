// DynamoDB-backed data access for the API Lambda (WR-040). Single-table (PK=USER#<sub>, SK=…).
// The AWS SDK v3 is provided by the Lambda Node runtime, so it's imported LAZILY here — that keeps
// the handler's unit tests (which inject a fake store) from needing @aws-sdk installed, and keeps
// `Code.fromAsset` bundler-free. Every access is scoped to the caller's own USER# partition.
let docClient;

async function client() {
  if (!docClient) {
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
    docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return docClient;
}

const TABLE = () => process.env.TABLE_NAME;

/** The DynamoDB profile store used at runtime. Free entitlement is the only tier for now. */
export const dynamoProfileStore = {
  async getOrCreateProfile(userId, email) {
    const { GetCommand, PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const db = await client();
    const key = { PK: `USER#${userId}`, SK: 'PROFILE' };
    const existing = await db.send(new GetCommand({ TableName: TABLE(), Key: key }));
    if (existing.Item) return toProfile(existing.Item);

    const item = {
      ...key,
      userId,
      email,
      entitlement: 'free',
      createdAt: new Date().toISOString(),
    };
    try {
      // ConditionExpression guards against a race creating two profiles for one user.
      await db.send(
        new PutCommand({
          TableName: TABLE(),
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return toProfile(item);
    } catch (e) {
      // Race loser: the other request created it first — return the winning profile, not an error.
      if (e?.name === 'ConditionalCheckFailedException') {
        const again = await db.send(new GetCommand({ TableName: TABLE(), Key: key }));
        if (again.Item) return toProfile(again.Item);
      }
      throw e;
    }
  },
};

/** Sync document access (WR-041). One SYNC item per user holding non-secret data (routes + prefs).
 *  The server is opaque about contents — the client guarantees no API keys are ever included. */
Object.assign(dynamoProfileStore, {
  async getSyncDoc(userId) {
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const db = await client();
    const r = await db.send(
      new GetCommand({ TableName: TABLE(), Key: { PK: `USER#${userId}`, SK: 'SYNC' } }),
    );
    return r.Item ? { doc: r.Item.doc ?? null, updatedAt: r.Item.updatedAt ?? null } : { doc: null, updatedAt: null };
  },

  async putSyncDoc(userId, doc) {
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const db = await client();
    const updatedAt = new Date().toISOString();
    await db.send(
      new PutCommand({
        TableName: TABLE(),
        Item: { PK: `USER#${userId}`, SK: 'SYNC', doc, updatedAt },
      }),
    );
    return { updatedAt };
  },
});

/** GDPR data access (WR-042): export + hard delete of everything under the user's partition, plus
 *  the Cognito login. Queries paginate and BatchWrite retries UnprocessedItems, so "all records" is
 *  literal even under throttling — we never report success on a partial wipe. */
Object.assign(dynamoProfileStore, {
  async exportUserData(userId) {
    const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
    const db = await client();
    const items = [];
    let ExclusiveStartKey;
    do {
      const r = await db.send(
        new QueryCommand({
          TableName: TABLE(),
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': `USER#${userId}` },
          ExclusiveStartKey,
        }),
      );
      items.push(...(r.Items ?? []));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return { userId, exportedAt: new Date().toISOString(), items };
  },

  async deleteUserData(userId) {
    const { QueryCommand, BatchWriteCommand } = await import('@aws-sdk/lib-dynamodb');
    const db = await client();
    let deleted = 0;
    let ExclusiveStartKey;
    do {
      const r = await db.send(
        new QueryCommand({
          TableName: TABLE(),
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': `USER#${userId}` },
          ProjectionExpression: 'PK, SK',
          ExclusiveStartKey,
        }),
      );
      const items = r.Items ?? [];
      for (let i = 0; i < items.length; i += 25) {
        let request = {
          [TABLE()]: items.slice(i, i + 25).map((it) => ({
            DeleteRequest: { Key: { PK: it.PK, SK: it.SK } },
          })),
        };
        for (let attempt = 0; attempt < 5 && request[TABLE()]?.length; attempt++) {
          const resp = await db.send(new BatchWriteCommand({ RequestItems: request }));
          request = resp.UnprocessedItems ?? {};
        }
        if (request[TABLE()]?.length) throw new Error('deletion incomplete');
      }
      deleted += items.length;
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return { deleted };
  },

  async deleteCognitoUser(userPoolId, username) {
    const { CognitoIdentityProviderClient, AdminDeleteUserCommand } = await import(
      '@aws-sdk/client-cognito-identity-provider'
    );
    const c = new CognitoIdentityProviderClient({});
    await c.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));
  },
});

function toProfile(item) {
  return {
    userId: item.userId,
    email: item.email,
    entitlement: item.entitlement ?? 'free',
    createdAt: item.createdAt,
  };
}
