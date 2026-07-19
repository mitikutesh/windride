import { useEffect, useState } from 'react';
import {
  API_KEY_NAMES,
  type ApiKeyName,
  effectiveLiveApis,
  useKeychainStore,
} from '../../state/keychainStore';
import { PrimaryButton } from './PrimaryButton';
import { Toggle } from './Toggle';

/**
 * Bring-your-own API keys (task #33). Any user enters their own keys here; they live only in this
 * browser (idb) and are sent only to the service they belong to — never bundled or uploaded (mirrors
 * the Strava-secret rule, DEC-027). A live-APIs toggle lets a build shipped with live off still go
 * live once the user supplies keys. The `ai` key is stored but reserved — no feature consumes it yet.
 */
interface KeyMeta {
  name: ApiKeyName;
  label: string;
  help: string;
  reserved?: boolean;
}

const KEY_META: Record<ApiKeyName, KeyMeta> = {
  ors: {
    name: 'ors',
    label: 'Routing — openrouteservice',
    help: 'Required for live route generation. Free tier at openrouteservice.org.',
  },
  digitransit: {
    name: 'digitransit',
    label: 'Transit — Digitransit',
    help: 'Optional. Ranks downwind return legs; without it, cards just say “check return times”.',
  },
  ai: {
    name: 'ai',
    label: 'AI key',
    help: 'Reserved for upcoming AI features — stored securely here, but nothing uses it yet.',
    reserved: true,
  },
};

function KeyRow({ meta }: { meta: KeyMeta }) {
  const saved = useKeychainStore((s) => Boolean(s.keys[meta.name]));
  const saveKey = useKeychainStore((s) => s.saveKey);
  const [draft, setDraft] = useState('');
  const [flash, setFlash] = useState<'saved' | 'cleared' | 'error' | null>(null);

  const save = async () => {
    const ok = await saveKey(meta.name, draft);
    setDraft('');
    setFlash(ok ? 'saved' : 'error');
  };
  const clear = async () => {
    const ok = await saveKey(meta.name, '');
    setDraft('');
    setFlash(ok ? 'cleared' : 'error');
  };

  return (
    <div className="wr-keys__row">
      <label className="wr-field__label">
        {meta.label}
        {meta.reserved ? <span className="wr-muted"> · reserved</span> : null}
        <input
          className="wr-input"
          type="password"
          autoComplete="off"
          placeholder={saved ? 'Saved ✓ — enter a new key to replace' : 'Paste your key'}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setFlash(null);
          }}
        />
      </label>
      <p className="wr-muted wr-keys__help">{meta.help}</p>
      <div className="wr-keys__actions">
        <PrimaryButton
          type="button"
          onClick={() => void save()}
          disabled={draft.trim().length === 0}
        >
          Save
        </PrimaryButton>
        <button
          type="button"
          className="wr-btn-secondary"
          onClick={() => void clear()}
          disabled={!saved}
        >
          Clear
        </button>
        <span className="wr-muted">
          {flash === 'saved'
            ? 'Saved.'
            : flash === 'cleared'
              ? 'Cleared.'
              : flash === 'error'
                ? 'Couldn’t save — browser storage unavailable.'
                : saved
                  ? 'Saved ✓'
                  : 'Not set'}
        </span>
      </div>
    </div>
  );
}

export function ApiKeysSettings() {
  const hydrate = useKeychainStore((s) => s.hydrate);
  const liveApis = useKeychainStore((s) => s.liveApis); // subscribe so the toggle re-renders
  const setLiveApis = useKeychainStore((s) => s.setLiveApis);
  const orsSet = useKeychainStore((s) => Boolean(s.keys.ors));
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // The explicit override wins; with none set, fall back to the build default (effectiveLiveApis
  // reads the registry). Reading `liveApis` from the store also re-renders the toggle on change.
  const live = liveApis ?? effectiveLiveApis();

  return (
    <div className="wr-keys">
      <p className="wr-muted">
        Bring your own keys. They’re stored only in this browser and sent only to the service they
        belong to — never uploaded or bundled into the app.
      </p>

      <Toggle
        checked={live}
        onChange={(on) => void setLiveApis(on)}
        label="Use live APIs (call real providers with your keys)"
      />
      {live && !orsSet ? (
        <p className="wr-muted">Live mode is on but no routing key is set — add one below.</p>
      ) : null}

      {API_KEY_NAMES.map((name) => (
        <KeyRow key={name} meta={KEY_META[name]} />
      ))}
    </div>
  );
}
