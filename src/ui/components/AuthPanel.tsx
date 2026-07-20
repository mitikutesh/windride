import { useEffect, useState } from 'react';
import { useAuthStore } from '../../state/authStore';
import { useGdprStore } from '../../state/gdprStore';
import { useProfileStore } from '../../state/profileStore';
import { useSyncStore } from '../../state/syncStore';
import { downloadText } from '../download';
import { PrimaryButton } from './PrimaryButton';

/**
 * Account sign up / in / out, confirmation, and password reset (WR-039). Progressive: the whole app
 * works signed-out — an account is optional (it unlocks cross-device sync later, WR-040/041). The
 * AI/BYO keys are never part of the account (DEC-040). Pure view over authStore; when the build has
 * no Cognito pool it says so plainly.
 */
export function AuthPanel() {
  const status = useAuthStore((s) => s.status);
  const session = useAuthStore((s) => s.session);
  const error = useAuthStore((s) => s.error);
  const configured = useAuthStore((s) => s.configured);
  const signUp = useAuthStore((s) => s.signUp);
  const confirm = useAuthStore((s) => s.confirm);
  const resend = useAuthStore((s) => s.resend);
  const signIn = useAuthStore((s) => s.signIn);
  const requestReset = useAuthStore((s) => s.requestReset);
  const confirmReset = useAuthStore((s) => s.confirmReset);
  const signOut = useAuthStore((s) => s.signOut);

  const profile = useProfileStore((s) => s.profile);
  const apiConfigured = useProfileStore((s) => s.configured);
  const loadProfile = useProfileStore((s) => s.load);
  const syncStatus = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const syncError = useSyncStore((s) => s.error);
  const syncNow = useSyncStore((s) => s.syncNow);
  const gdprStatus = useGdprStore((s) => s.status);
  const gdprError = useGdprStore((s) => s.error);
  const exportData = useGdprStore((s) => s.exportData);
  const deleteAccount = useGdprStore((s) => s.deleteAccount);

  const onExport = async () => {
    const data = await exportData();
    if (data) {
      downloadText('windride-data.json', 'application/json', JSON.stringify(data, null, 2));
    }
  };

  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const busy = status === 'authenticating';

  // On sign-in, fetch the profile/entitlement from the backend (only when a backend is configured).
  useEffect(() => {
    if (status === 'authenticated' && apiConfigured) void loadProfile();
  }, [status, apiConfigured, loadProfile]);

  const err = error ? (
    <p className="wr-muted" role="alert">
      {error}
    </p>
  ) : null;

  if (!configured) {
    return (
      <p className="wr-muted">
        Accounts aren’t set up in this build. Everything works without one: your keys and data stay
        in this browser. Where an account is configured, it syncs your saved routes across devices,
        and never your keys. See{' '}
        <a className="wr-link" href="#/privacy">
          Privacy &amp; your data
        </a>
        .
      </p>
    );
  }

  if (status === 'authenticated' && session) {
    return (
      <div className="wr-auth">
        <p>
          Signed in as <strong>{session.email}</strong>.
        </p>
        {profile ? (
          <p className="wr-muted">
            Plan: <strong>{profile.entitlement}</strong>. Cross-device sync of your saved routes is
            available on this account. Your API keys stay in this browser and are never synced.
          </p>
        ) : null}
        {apiConfigured ? (
          <div className="wr-auth__sync">
            <button
              type="button"
              className="wr-navlink"
              disabled={syncStatus === 'syncing'}
              onClick={() => void syncNow()}
            >
              {syncStatus === 'syncing' ? 'Syncing…' : 'Sync saved routes now'}
            </button>
            {syncStatus === 'ready' && lastSyncedAt ? (
              <span className="wr-muted"> Synced.</span>
            ) : null}
            {syncStatus === 'error' && syncError ? (
              <span className="wr-muted"> {syncError}</span>
            ) : null}
          </div>
        ) : null}
        <div className="wr-auth__gdpr">
          {apiConfigured ? (
            <>
              <button
                type="button"
                className="wr-navlink"
                disabled={gdprStatus === 'exporting'}
                onClick={() => void onExport()}
              >
                {gdprStatus === 'exporting' ? 'Exporting…' : 'Export my data'}
              </button>
              {!confirmingDelete ? (
                <button
                  type="button"
                  className="wr-navlink wr-navlink--danger"
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete account
                </button>
              ) : (
                <div className="wr-auth__confirm">
                  <label className="wr-field__label">
                    This permanently erases your account and all its server-side data. Type{' '}
                    <strong>DELETE</strong> to confirm.
                    <input
                      className="wr-input"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      aria-label="Type DELETE to confirm"
                    />
                  </label>
                  <button
                    type="button"
                    className="wr-navlink wr-navlink--danger"
                    disabled={deleteConfirmText !== 'DELETE' || gdprStatus === 'deleting'}
                    onClick={() => void deleteAccount()}
                  >
                    {gdprStatus === 'deleting' ? 'Deleting…' : 'Permanently delete'}
                  </button>
                  <button
                    type="button"
                    className="wr-navlink"
                    onClick={() => {
                      setConfirmingDelete(false);
                      setDeleteConfirmText('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {gdprStatus === 'error' && gdprError ? (
                <p className="wr-muted" role="alert">
                  {gdprError}
                </p>
              ) : null}
            </>
          ) : null}
          <p className="wr-muted">
            <a className="wr-link" href="#/privacy">
              Privacy &amp; your data
            </a>
          </p>
        </div>
        <button type="button" className="wr-btn-secondary" onClick={signOut}>
          Sign out
        </button>
      </div>
    );
  }

  if (status === 'awaiting-confirmation') {
    return (
      <form
        className="wr-auth"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm(code.trim());
        }}
      >
        <p className="wr-muted">
          We emailed you a confirmation code. Enter it to finish registering.
        </p>
        <label className="wr-field__label">
          Confirmation code
          <input
            className="wr-input"
            value={code}
            inputMode="numeric"
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <PrimaryButton type="submit" disabled={busy || code.trim().length === 0}>
          {busy ? 'Confirming…' : 'Confirm'}
        </PrimaryButton>
        <button type="button" className="wr-navlink" onClick={() => void resend()}>
          Resend code
        </button>
        {err}
      </form>
    );
  }

  if (status === 'awaiting-reset') {
    return (
      <form
        className="wr-auth"
        onSubmit={(e) => {
          e.preventDefault();
          void confirmReset(code.trim(), password);
        }}
      >
        <p className="wr-muted">Enter the reset code we emailed you and choose a new password.</p>
        <label className="wr-field__label">
          Reset code
          <input
            className="wr-input"
            value={code}
            inputMode="numeric"
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <label className="wr-field__label">
          New password
          <input
            className="wr-input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <PrimaryButton
          type="submit"
          disabled={busy || code.trim().length === 0 || password.length === 0}
        >
          {busy ? 'Saving…' : 'Set new password'}
        </PrimaryButton>
        {err}
      </form>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'register') void signUp(email.trim(), password);
    else void signIn(email.trim(), password);
  };

  return (
    <form className="wr-auth" onSubmit={submit}>
      <div className="wr-auth__modes">
        <button
          type="button"
          className={`wr-navlink${mode === 'signin' ? ' wr-navlink--active' : ''}`}
          onClick={() => setMode('signin')}
        >
          Sign in
        </button>
        <button
          type="button"
          className={`wr-navlink${mode === 'register' ? ' wr-navlink--active' : ''}`}
          onClick={() => setMode('register')}
        >
          Register
        </button>
      </div>
      <label className="wr-field__label">
        Email
        <input
          className="wr-input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="wr-field__label">
        Password
        <input
          className="wr-input"
          type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <PrimaryButton
        type="submit"
        disabled={busy || email.trim().length === 0 || password.length === 0}
      >
        {busy ? 'Working…' : mode === 'register' ? 'Create account' : 'Sign in'}
      </PrimaryButton>
      {mode === 'signin' ? (
        <button
          type="button"
          className="wr-navlink"
          disabled={email.trim().length === 0}
          onClick={() => void requestReset(email.trim())}
        >
          Forgot password?
        </button>
      ) : null}
      <p className="wr-muted">
        An account syncs only your saved routes and preferences, never your keys. See{' '}
        <a className="wr-link" href="#/privacy">
          Privacy &amp; your data
        </a>
        .
      </p>
      {err}
    </form>
  );
}
