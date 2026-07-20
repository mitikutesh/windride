// state/gdprStore.ts — GDPR data export + account deletion (WR-042). The UI never touches adapters;
// this store owns the calls. Export pulls all server-side records; delete wipes the DynamoDB data
// AND removes the Cognito user (self DeleteUser), then signs out. BYO keys are never involved (they
// live only in this browser, DEC-040). All I/O injectable so tests never hit the network.
import { create } from 'zustand';
import { HttpApiClient } from '../adapters/api/client';
import type { ApiClient } from '../adapters/api/types';
import { useAuthStore } from './authStore';

type Status = 'idle' | 'exporting' | 'deleting' | 'done' | 'error';

interface GdprDeps {
  api?: ApiClient;
  getToken?: () => Promise<string | null>;
}

interface GdprState {
  status: Status;
  error: string | null;
  exportData: (deps?: GdprDeps) => Promise<unknown | null>;
  deleteAccount: (deps?: GdprDeps) => Promise<boolean>;
  reset: () => void;
}

export const useGdprStore = create<GdprState>((set) => ({
  status: 'idle',
  error: null,

  exportData: async (deps = {}) => {
    const getToken = deps.getToken ?? (() => useAuthStore.getState().ensureFreshToken());
    const token = await getToken();
    if (!token) {
      set({ status: 'error', error: 'Sign in to export your data.' });
      return null;
    }
    const api = deps.api ?? new HttpApiClient();
    set({ status: 'exporting', error: null });
    try {
      const data = await api.exportData(token);
      set({ status: 'done', error: null });
      return data;
    } catch {
      set({ status: 'error', error: 'Could not export your data right now.' });
      return null;
    }
  },

  deleteAccount: async (deps = {}) => {
    const getToken = deps.getToken ?? (() => useAuthStore.getState().ensureFreshToken());
    const token = await getToken();
    if (!token) {
      set({ status: 'error', error: 'Sign in first.' });
      return false;
    }
    const api = deps.api ?? new HttpApiClient();
    set({ status: 'deleting', error: null });
    try {
      // The server removes the Cognito login AND wipes the data in one call (login first), so there
      // is no half-deleted state to explain and the invalidated session can't re-create data.
      await api.deleteAccount(token);
      useAuthStore.getState().signOut();
      set({ status: 'done', error: null });
      return true;
    } catch {
      set({ status: 'error', error: 'Account deletion didn’t complete. Please try again.' });
      return false;
    }
  },

  reset: () => set({ status: 'idle', error: null }),
}));
