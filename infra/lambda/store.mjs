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

function toProfile(item) {
  return {
    userId: item.userId,
    email: item.email,
    entitlement: item.entitlement ?? 'free',
    createdAt: item.createdAt,
  };
}
