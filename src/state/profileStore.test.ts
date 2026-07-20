import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiClient, Profile } from '../adapters/api/types';
import { useProfileStore } from './profileStore';

const PROFILE: Profile = { userId: 'u1', email: 'a@b.co', entitlement: 'free', createdAt: '2026' };

function client(over: Partial<ApiClient> = {}): ApiClient {
  const base: ApiClient = {
    getMe: async () => PROFILE,
    getSync: async () => ({ doc: null, updatedAt: null }),
    putSync: async () => ({ updatedAt: 't' }),
  };
  return { ...base, ...over };
}

beforeEach(() => useProfileStore.getState().reset());

describe('profileStore.load', () => {
  it('loads the profile with a fresh token', async () => {
    await useProfileStore.getState().load({ client: client(), getToken: async () => 'tok' });
    const s = useProfileStore.getState();
    expect(s.status).toBe('ready');
    expect(s.profile?.entitlement).toBe('free');
  });

  it('errors (no call) when there is no token — signed out', async () => {
    let called = false;
    await useProfileStore.getState().load({
      client: client({
        getMe: async () => {
          called = true;
          return PROFILE;
        },
      }),
      getToken: async () => null,
    });
    expect(useProfileStore.getState().status).toBe('error');
    expect(called).toBe(false);
  });

  it('errors when the backend call fails', async () => {
    await useProfileStore.getState().load({
      client: client({
        getMe: async () => {
          throw new Error('500');
        },
      }),
      getToken: async () => 'tok',
    });
    expect(useProfileStore.getState().status).toBe('error');
    expect(useProfileStore.getState().profile).toBeNull();
  });
});
