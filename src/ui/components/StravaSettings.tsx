import { useEffect, useState } from 'react';
import { getStravaCreds, setStravaCreds } from '../../data/db';
import { PrimaryButton } from './PrimaryButton';

/**
 * Owner Strava credentials form (WR-023). Stores clientId/clientSecret/refreshToken in idb — never
 * in Vite env (would be bundled). Obtain them once via `node tools/strava-auth.mjs` (activity:write).
 */
export function StravaSettings() {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [saved, setSaved] = useState(false);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    getStravaCreds()
      .then((c) => {
        if (c) {
          setClientId(c.clientId);
          setConfigured(true);
        }
      })
      .catch(() => {}); // idb unavailable (e.g. tests) — just show the empty form
  }, []);

  const [error, setError] = useState(false);
  const save = async () => {
    if (!clientId || !clientSecret || !refreshToken) return;
    try {
      await setStravaCreds({ clientId, clientSecret, refreshToken });
      setSaved(true);
      setConfigured(true);
      setError(false);
    } catch {
      setError(true);
    }
  };

  return (
    <form
      className="wr-strava-settings"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="wr-muted">
        Upload-only. Run <code>node tools/strava-auth.mjs</code>, then paste the values.
        {configured ? ' Configured ✓' : ''}
      </p>
      <label className="wr-field__label">
        Client ID
        <input
          className="wr-input"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
      </label>
      <label className="wr-field__label">
        Client secret
        <input
          className="wr-input"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </label>
      <label className="wr-field__label">
        Refresh token
        <input
          className="wr-input"
          type="password"
          value={refreshToken}
          onChange={(e) => setRefreshToken(e.target.value)}
        />
      </label>
      <PrimaryButton type="submit">Save Strava credentials</PrimaryButton>
      {saved ? <span className="wr-muted"> Saved.</span> : null}
      {error ? <span className="wr-muted"> Could not save.</span> : null}
    </form>
  );
}
