import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '../adapters/api/types';
import type { Session } from '../adapters/auth/types';
import { useAuthStore } from './authStore';
import { useGdprStore } from './gdprStore';

const SESSION: Session = {
  idToken: 'i',
  accessToken: 'acc',
  refreshToken: 'r',
  expiresAt: Date.now() + 3_600_000,
  email: 'a@b.co',
};

function api(over: Partial<ApiClient> = {}): ApiClient {
  const base: ApiClient = {
    getMe: async () => ({ userId: 'u', email: 'e', entitlement: 'free', createdAt: '' }),
    getSync: async () => ({ doc: null, updatedAt: null }),
    putSync: async () => ({ updatedAt: 't' }),
    exportData: async () => ({ items: [{ SK: 'PROFILE' }] }),
    deleteAccount: async () => ({ deleted: 2 }),
  };
  return { ...base, ...over };
}

beforeEach(() => {
  useGdprStore.getState().reset();
  useAuthStore.setState({ status: 'authenticated', session: SESSION });
});

describe('gdprStore', () => {
  it('exportData returns the server records', async () => {
    const data = await useGdprStore
      .getState()
      .exportData({ getToken: async () => 'tok', api: api() });
    expect((data as { items: unknown[] }).items).toHaveLength(1);
    expect(useGdprStore.getState().status).toBe('done');
  });

  it('deleteAccount calls the server erasure (which removes login + data), then signs out', async () => {
    let dataDeleted = false;
    const ok = await useGdprStore.getState().deleteAccount({
      getToken: async () => 'tok',
      api: api({
        deleteAccount: async () => {
          dataDeleted = true;
          return { deleted: 2 };
        },
      }),
    });
    expect(ok).toBe(true);
    expect(dataDeleted).toBe(true);
    expect(useAuthStore.getState().session).toBeNull(); // signed out
  });

  it('reports an error and does not sign out if deletion fails', async () => {
    const ok = await useGdprStore.getState().deleteAccount({
      getToken: async () => 'tok',
      api: api({
        deleteAccount: async () => {
          throw new Error('server error');
        },
      }),
    });
    expect(ok).toBe(false);
    expect(useGdprStore.getState().status).toBe('error');
    expect(useAuthStore.getState().session).not.toBeNull(); // still signed in
  });
});
