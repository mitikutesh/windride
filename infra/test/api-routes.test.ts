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
};

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
});
