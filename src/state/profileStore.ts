// state/profileStore.ts — the signed-in user's profile + entitlement (WR-040). The UI never touches
// adapters; this store gets a fresh id token from authStore, calls GET /me, and holds the result.
// Client + token getter are injectable so tests never hit the network. No BYO key is involved.
import { create } from 'zustand';
import { apiConfigured, HttpApiClient } from '../adapters/api/client';
import type { ApiClient, Profile } from '../adapters/api/types';
import { useAuthStore } from './authStore';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface LoadDeps {
  client?: ApiClient;
  getToken?: () => Promise<string | null>;
}

interface ProfileState {
  status: Status;
  profile: Profile | null;
  error: string | null;
  /** Whether this build has a backend URL configured (VITE_API_URL). */
  configured: boolean;
  load: (deps?: LoadDeps) => Promise<void>;
  reset: () => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  status: 'idle',
  profile: null,
  error: null,
  configured: apiConfigured(),

  load: async (deps) => {
    const getToken = deps?.getToken ?? (() => useAuthStore.getState().ensureFreshToken());
    const token = await getToken();
    if (!token) {
      set({ status: 'error', error: 'Sign in to load your profile.', profile: null });
      return;
    }
    const client = deps?.client ?? new HttpApiClient();
    set({ status: 'loading', error: null });
    try {
      const profile = await client.getMe(token);
      set({ status: 'ready', profile, error: null });
    } catch {
      set({ status: 'error', error: 'Could not load your profile right now.', profile: null });
    }
  },

  reset: () => set({ status: 'idle', profile: null, error: null }),
}));

export type { Profile } from '../adapters/api/types';
