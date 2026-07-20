import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useAuthStore, type Session } from '../../state/authStore';
import { useGdprStore } from '../../state/gdprStore';
import { useProfileStore } from '../../state/profileStore';
import { AuthPanel } from './AuthPanel';

const SESSION: Session = {
  idToken: 'i',
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: Date.now() + 3_600_000,
  email: 'rider@example.com',
};

beforeEach(() => {
  useAuthStore.setState({ status: 'anonymous', session: null, pendingEmail: null, error: null });
});

describe('AuthPanel', () => {
  it('explains accounts are not set up when the build has no Cognito pool', () => {
    useAuthStore.setState({ configured: false });
    render(<AuthPanel />);
    expect(screen.getByText(/aren’t set up in this build/i)).toBeInTheDocument();
  });

  it('offers sign-in + register when configured and signed out', () => {
    useAuthStore.setState({ configured: true, status: 'anonymous' });
    render(<AuthPanel />);
    // "Sign in" appears twice (the mode toggle + the submit button) — both are the sign-in form.
    expect(screen.getAllByRole('button', { name: /^Sign in$/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /^Register$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('shows the signed-in email + a sign-out button when authenticated', () => {
    useAuthStore.setState({ configured: true, status: 'authenticated', session: SESSION });
    render(<AuthPanel />);
    expect(screen.getByText(/rider@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('account deletion requires typing DELETE before it can fire (type-to-confirm)', () => {
    useAuthStore.setState({ configured: true, status: 'authenticated', session: SESSION });
    // Force the backend-configured GDPR block to render (VITE_API_URL is unset in tests).
    useProfileStore.setState({ configured: true });
    useGdprStore.setState({ status: 'idle', error: null });
    render(<AuthPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Delete account$/i }));
    const confirmBtn = screen.getByRole('button', { name: /Permanently delete/i });
    expect(confirmBtn).toBeDisabled(); // no text yet
    fireEvent.change(screen.getByLabelText(/type DELETE to confirm/i), {
      target: { value: 'DELETE' },
    });
    expect(confirmBtn).toBeEnabled();
  });
});
