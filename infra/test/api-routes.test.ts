import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM JS handler (no types).
import { route } from '../lambda/index.mjs';

const meEvent = (auth?: string) => ({
  requestContext: { http: { method: 'GET' } },
  rawPath: '/me',
  headers: auth ? { authorization: auth } : {},
});

const fakeStore = {
  getOrCreateProfile: async (userId: string, email: string) => ({
    userId,
    email,
    entitlement: 'free',
    createdAt: '2026-07-20T00:00:00Z',
  }),
  getSyncDoc: async () => ({ doc: { savedRoutes: [], prefs: {} }, updatedAt: 't1' }),
  putSyncDoc: async () => ({ updatedAt: 't2' }),
  exportUserData: async (userId: string) => ({ userId, exportedAt: 'now', items: [{ SK: 'PROFILE' }] }),
  deleteUserData: async () => ({ deleted: 3 }),
  deleteCognitoUser: async () => {},
};

const okVerify = async () => ({ sub: 'u1', email: 'a@b.co' });
const syncPut = (body: unknown, auth = 'Bearer good') => ({
  requestContext: { http: { method: 'PUT' } },
  rawPath: '/sync',
  headers: { authorization: auth },
  body: JSON.stringify(body),
  isBase64Encoded: false,
});

describe('API /me route (WR-040)', () => {
  it('returns the profile + free entitlement for a valid token', async () => {
    const res = await route(meEvent('Bearer good'), {
      verify: async () => ({ sub: 'u1', email: 'a@b.co' }),
      store: fakeStore,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.userId).toBe('u1');
    expect(body.entitlement).toBe('free');
  });

  it('401s with no bearer token (never touches the store)', async () => {
    let touched = false;
    const res = await route(meEvent(), {
      verify: async () => ({ sub: 'u1' }),
      store: {
        getOrCreateProfile: async () => {
          touched = true;
          return {};
        },
      },
    });
    expect(res.statusCode).toBe(401);
    expect(touched).toBe(false);
  });

  it('401s when the token fails verification', async () => {
    const res = await route(meEvent('Bearer bad'), {
      verify: async () => {
        throw new Error('bad signature');
      },
      store: fakeStore,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 500 (not an unhandled error) when the store fails', async () => {
    const res = await route(meEvent('Bearer good'), {
      verify: async () => ({ sub: 'u1', email: 'a@b.co' }),
      store: {
        getOrCreateProfile: async () => {
          throw new Error('dynamo down');
        },
      },
    });
    expect(res.statusCode).toBe(500);
  });

  it('still serves GET /health', async () => {
    const res = await route({ requestContext: { http: { method: 'GET' } }, rawPath: '/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('ok');
  });

  it('GET /sync returns the caller’s doc for a valid token', async () => {
    const res = await route(
      { requestContext: { http: { method: 'GET' } }, rawPath: '/sync', headers: { authorization: 'Bearer good' } },
      { verify: okVerify, store: fakeStore },
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).updatedAt).toBe('t1');
  });

  it('PUT /sync stores the doc and returns the new timestamp', async () => {
    const res = await route(syncPut({ doc: { savedRoutes: [], prefs: {} } }), {
      verify: okVerify,
      store: fakeStore,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).updatedAt).toBe('t2');
  });

  it('PUT /sync rejects a body with no doc object (or an array doc) → 400', async () => {
    expect((await route(syncPut({ notDoc: true }), { verify: okVerify, store: fakeStore })).statusCode).toBe(400);
    expect((await route(syncPut({ doc: [] }), { verify: okVerify, store: fakeStore })).statusCode).toBe(400);
  });

  it('PUT /sync rejects an over-large doc → 413 (never 500)', async () => {
    const huge = { doc: { savedRoutes: [], blob: 'x'.repeat(300 * 1024) } };
    const res = await route(syncPut(huge), { verify: okVerify, store: fakeStore });
    expect(res.statusCode).toBe(413);
  });

  it('/sync requires auth → 401 without a token', async () => {
    const res = await route(
      { requestContext: { http: { method: 'GET' } }, rawPath: '/sync', headers: {} },
      { verify: okVerify, store: fakeStore },
    );
    expect(res.statusCode).toBe(401);
  });

  it('GET /export returns the caller’s records (GDPR)', async () => {
    const res = await route(
      { requestContext: { http: { method: 'GET' } }, rawPath: '/export', headers: { authorization: 'Bearer good' } },
      { verify: okVerify, store: fakeStore },
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).items).toHaveLength(1);
  });

  it('DELETE /me erases the caller’s data + Cognito login (GDPR), requires auth', async () => {
    let cognitoDeleted = false;
    const ok = await route(
      { requestContext: { http: { method: 'DELETE' } }, rawPath: '/me', headers: { authorization: 'Bearer good' } },
      {
        verify: okVerify,
        store: { ...fakeStore, deleteCognitoUser: async () => { cognitoDeleted = true; } },
      },
    );
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).deleted).toBe(3);
    expect(cognitoDeleted).toBe(true); // login removed too

    const noAuth = await route(
      { requestContext: { http: { method: 'DELETE' } }, rawPath: '/me', headers: {} },
      { verify: okVerify, store: fakeStore },
    );
    expect(noAuth.statusCode).toBe(401);
  });
});
