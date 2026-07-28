// state/authStore.ts — Cognito auth session (WR-039). Progressive: the app works fully signed-out;
// an account is opt-in. The UI never touches adapters — this store owns the CognitoAuthClient call,
// holds the session (persisted to idb like the Strava creds), and phrases failures by cause. The
// client is injectable so tests never hit the network. API keys are NOT part of the session and are
// never synced (DEC-040) — a session is only the Cognito JWTs.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { authConfigured, CognitoAuthClient } from '../adapters/auth/cognito';
import type { AuthClient, Session } from '../adapters/auth/types';
import { isBrowserOffline, isProviderError } from '../adapters/errors';
import { idbStateStorage } from './persist';

// Re-exported so UI can name the session type without importing adapters (ARCHITECTURE §3 boundary).
export type { Session } from '../adapters/auth/types';

type Status =
  | 'anonymous'
  | 'authenticating'
  | 'awaiting-confirmation'
  | 'awaiting-reset'
  | 'authenticated'
  | 'error';

interface AuthState {
  status: Status;
  session: Session | null;
  /** Email carried between sign-up/reset and its confirmation step. */
  pendingEmail: string | null;
  error: string | null;
  /** Whether this build has a Cognito pool configured (VITE_COGNITO_*). */
  configured: boolean;
  signUp: (email: string, password: string, client?: AuthClient) => Promise<void>;
  confirm: (code: string, client?: AuthClient) => Promise<void>;
  /** Re-send the sign-up confirmation code to pendingEmail. */
  resend: (client?: AuthClient) => Promise<void>;
  signIn: (email: string, password: string, client?: AuthClient) => Promise<void>;
  /** Start a password reset — Cognito emails a code. */
  requestReset: (email: string, client?: AuthClient) => Promise<void>;
  /** Complete a password reset with the emailed code + a new password. */
  confirmReset: (code: string, newPassword: string, client?: AuthClient) => Promise<void>;
  signOut: () => void;
  /** Return a valid id token, silently refreshing an expired session first; null if signed out. */
  ensureFreshToken: (client?: AuthClient) => Promise<string | null>;
}

/** Friendly, cause-naming copy for an auth failure (mirrors stravaFailureReason / aiFailureReason). */
function authErrorReason(e: unknown): string {
  if (isProviderError(e)) {
    if (e.code === 'no-config') return 'Accounts aren’t set up in this build.';
    if (e.kind === 'quota') return 'Too many attempts — please wait a bit and try again.';
    if (e.kind === 'network') {
      // Auth needs no user-supplied key, but still be honest about offline vs unreachable.
      return e.code === 'offline' || isBrowserOffline()
        ? 'You appear to be offline. Check your connection.'
        : 'Couldn’t reach the sign-in service — it may be temporarily unavailable. Try again in a moment.';
    }
    switch (e.code) {
      case 'UsernameExists':
        return 'That email is already registered — sign in instead.';
      case 'NotAuthorized':
        return 'Wrong email or password.';
      case 'UserNotConfirmed':
        return 'Confirm your email first — check for the code we sent.';
      case 'CodeMismatch':
        return 'That code doesn’t match — check the email and try again.';
      case 'ExpiredCode':
        return 'That code expired — request a new one.';
      case 'InvalidPassword':
        return 'Password too weak: at least 8 chars with upper, lower and a number.';
      default:
        return e.message || 'Something went wrong — try again.';
    }
  }
  return 'Something went wrong — try again.';
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      status: 'anonymous',
      session: null,
      pendingEmail: null,
      error: null,
      configured: authConfigured(),

      signUp: async (email, password, client = new CognitoAuthClient()) => {
        set({ status: 'authenticating', error: null });
        try {
          await client.signUp(email, password);
          set({ status: 'awaiting-confirmation', pendingEmail: email, error: null });
        } catch (e) {
          set({ status: 'error', error: authErrorReason(e) });
        }
      },

      confirm: async (code, client = new CognitoAuthClient()) => {
        const email = useAuthStore.getState().pendingEmail;
        if (!email) return;
        set({ status: 'authenticating', error: null });
        try {
          await client.confirmSignUp(email, code);
          // Confirmed but not signed in (Cognito returns no tokens here) — back to the sign-in form.
          set({ status: 'anonymous', pendingEmail: null, error: null });
        } catch (e) {
          set({ status: 'awaiting-confirmation', error: authErrorReason(e) });
        }
      },

      resend: async (client = new CognitoAuthClient()) => {
        const email = useAuthStore.getState().pendingEmail;
        if (!email) return;
        try {
          await client.resendConfirmationCode(email);
          set({ status: 'awaiting-confirmation', error: 'A new code is on its way.' });
        } catch (e) {
          set({ status: 'awaiting-confirmation', error: authErrorReason(e) });
        }
      },

      signIn: async (email, password, client = new CognitoAuthClient()) => {
        set({ status: 'authenticating', error: null });
        try {
          const session = await client.signIn(email, password);
          set({ status: 'authenticated', session, error: null, pendingEmail: null });
        } catch (e) {
          // An unconfirmed account isn't an error — route to the confirmation step (survives reload
          // this way, since the confirm form is reachable again from a sign-in attempt).
          if (isProviderError(e) && e.code === 'UserNotConfirmed') {
            set({
              status: 'awaiting-confirmation',
              pendingEmail: email,
              error: 'Confirm your email first — enter the code we sent (or resend it).',
            });
            return;
          }
          set({ status: 'error', error: authErrorReason(e) });
        }
      },

      requestReset: async (email, client = new CognitoAuthClient()) => {
        set({ status: 'authenticating', error: null });
        try {
          await client.forgotPassword(email);
          set({ status: 'awaiting-reset', pendingEmail: email, error: null });
        } catch (e) {
          set({ status: 'error', error: authErrorReason(e) });
        }
      },

      confirmReset: async (code, newPassword, client = new CognitoAuthClient()) => {
        const email = useAuthStore.getState().pendingEmail;
        if (!email) return;
        set({ status: 'authenticating', error: null });
        try {
          await client.confirmForgotPassword(email, code, newPassword);
          // Password changed — back to sign-in.
          set({ status: 'anonymous', pendingEmail: null, error: null });
        } catch (e) {
          set({ status: 'awaiting-reset', error: authErrorReason(e) });
        }
      },

      signOut: () => set({ status: 'anonymous', session: null, error: null, pendingEmail: null }),

      ensureFreshToken: async (client = new CognitoAuthClient()): Promise<string | null> => {
        const s = useAuthStore.getState().session;
        if (!s) return null;
        if (s.expiresAt - 60_000 > Date.now()) return s.idToken; // still valid (60s skew margin)
        try {
          const fresh = await client.refresh(s.refreshToken, s.email);
          set({ status: 'authenticated', session: fresh });
          return fresh.idToken;
        } catch {
          set({ status: 'anonymous', session: null }); // refresh failed → reflect signed-out reality
          return null;
        }
      },
    }),
    {
      name: 'windride-auth',
      storage: createJSONStorage(() => idbStateStorage),
      // Persist only the session; re-derive status on load.
      partialize: (s) => ({ session: s.session }),
      onRehydrateStorage: () => (state) => {
        if (state?.session) state.status = 'authenticated';
      },
    },
  ),
);

/** The current id token if valid (60s skew), or null when signed out / expired. For a guaranteed
 *  fresh token, call `useAuthStore.getState().ensureFreshToken()` (silently refreshes). */
export function currentIdToken(): string | null {
  const s = useAuthStore.getState().session;
  if (!s) return null;
  return s.expiresAt - 60_000 > Date.now() ? s.idToken : null;
}
