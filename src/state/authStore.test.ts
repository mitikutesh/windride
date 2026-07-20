import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthClient, Session } from '../adapters/auth/types';
import { ProviderError } from '../adapters/errors';
import { useAuthStore } from './authStore';

const SESSION: Session = {
  idToken: 'i',
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: Date.now() + 3_600_000,
  email: 'a@b.co',
};

function mockClient(over: Partial<AuthClient> = {}): AuthClient {
  return {
    signUp: async () => {},
    confirmSignUp: async () => {},
    resendConfirmationCode: async () => {},
    signIn: async () => SESSION,
    refresh: async () => SESSION,
    forgotPassword: async () => {},
    confirmForgotPassword: async () => {},
    ...over,
  };
}

beforeEach(() => {
  useAuthStore.setState({ status: 'anonymous', session: null, pendingEmail: null, error: null });
});

describe('authStore', () => {
  it('sign up moves to awaiting-confirmation and remembers the email', async () => {
    await useAuthStore.getState().signUp('a@b.co', 'Password1', mockClient());
    const s = useAuthStore.getState();
    expect(s.status).toBe('awaiting-confirmation');
    expect(s.pendingEmail).toBe('a@b.co');
  });

  it('confirm returns to anonymous (ready to sign in)', async () => {
    useAuthStore.setState({ status: 'awaiting-confirmation', pendingEmail: 'a@b.co' });
    await useAuthStore.getState().confirm('123456', mockClient());
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().pendingEmail).toBeNull();
  });

  it('sign in stores the session and authenticates', async () => {
    await useAuthStore.getState().signIn('a@b.co', 'pw', mockClient());
    const s = useAuthStore.getState();
    expect(s.status).toBe('authenticated');
    expect(s.session?.idToken).toBe('i');
  });

  it('surfaces a friendly, cause-named error (wrong password)', async () => {
    const client = mockClient({
      async signIn() {
        throw new ProviderError('badResponse', 'Incorrect username or password.', 'NotAuthorized');
      },
    });
    await useAuthStore.getState().signIn('a@b.co', 'bad', client);
    const s = useAuthStore.getState();
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/wrong email or password/i);
  });

  it('sign out clears the session', async () => {
    await useAuthStore.getState().signIn('a@b.co', 'pw', mockClient());
    useAuthStore.getState().signOut();
    const s = useAuthStore.getState();
    expect(s.status).toBe('anonymous');
    expect(s.session).toBeNull();
  });

  it('routes an unconfirmed sign-in back to the confirmation step (not a dead-end error)', async () => {
    const client = mockClient({
      async signIn() {
        throw new ProviderError('badResponse', 'User is not confirmed.', 'UserNotConfirmed');
      },
    });
    await useAuthStore.getState().signIn('a@b.co', 'pw', client);
    const s = useAuthStore.getState();
    expect(s.status).toBe('awaiting-confirmation');
    expect(s.pendingEmail).toBe('a@b.co');
  });

  it('password reset: request → awaiting-reset, confirm → anonymous', async () => {
    await useAuthStore.getState().requestReset('a@b.co', mockClient());
    expect(useAuthStore.getState().status).toBe('awaiting-reset');
    expect(useAuthStore.getState().pendingEmail).toBe('a@b.co');
    await useAuthStore.getState().confirmReset('123456', 'NewPass1', mockClient());
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('ensureFreshToken refreshes an expired session and returns the new token', async () => {
    const fresh: Session = { ...SESSION, idToken: 'i2', expiresAt: Date.now() + 3_600_000 };
    useAuthStore.setState({
      status: 'authenticated',
      session: { ...SESSION, expiresAt: Date.now() - 1000 }, // expired
    });
    const token = await useAuthStore
      .getState()
      .ensureFreshToken(mockClient({ refresh: async () => fresh }));
    expect(token).toBe('i2');
    expect(useAuthStore.getState().session?.idToken).toBe('i2');
  });

  it('ensureFreshToken signs out when the refresh fails', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      session: { ...SESSION, expiresAt: Date.now() - 1000 },
    });
    const client = mockClient({
      async refresh() {
        throw new ProviderError('badResponse', 'refresh token revoked', 'NotAuthorized');
      },
    });
    const token = await useAuthStore.getState().ensureFreshToken(client);
    expect(token).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();
  });
});
