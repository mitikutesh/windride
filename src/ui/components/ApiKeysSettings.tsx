import { useEffect, useState } from 'react';
import {
  AI_PROVIDERS,
  API_KEY_NAMES,
  type ApiKeyName,
  effectiveLiveApis,
  isAiProvider,
  routingKeyAvailable,
  useKeychainStore,
} from '../../state/keychainStore';
import { PrimaryButton } from './PrimaryButton';
import { Toggle } from './Toggle';

/**
 * Bring-your-own API keys (task #33, WR-044). Any user enters their own keys here; they live only in
 * this browser (idb) and are sent only to the service they belong to — never bundled or uploaded
 * (mirrors the Strava-secret rule, DEC-027; never synced server-side, DEC-040). A live-APIs toggle
 * lets a build shipped with live off still go live once the user supplies keys. AI is bring-your-own
 * too: pick a provider, paste that provider's key, and the optional AI features (WR-045+) turn on.
 */
interface KeyMeta {
  name: ApiKeyName;
  label: string;
  help: string;
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
    help: 'Powers the optional AI features. Pick your provider above, then paste that provider’s key.',
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

/** The AI provider picker (WR-044): each user chooses their own provider; the `ai` key is theirs. */
function AiProviderPicker() {
  const provider = useKeychainStore((s) => s.aiProvider);
  const setAiProvider = useKeychainStore((s) => s.setAiProvider);
  const active = provider ? AI_PROVIDERS.find((p) => p.id === provider) : undefined;

  return (
    <div className="wr-keys__row">
      <label className="wr-field__label">
        AI provider
        <select
          className="wr-input"
          value={provider ?? ''}
          onChange={(e) => void setAiProvider(isAiProvider(e.target.value) ? e.target.value : null)}
        >
          <option value="">None — AI features off</option>
          {AI_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <p className="wr-muted wr-keys__help">
        {active ? (
          <>
            {active.help}{' '}
            <a className="wr-link" href={active.keysUrl} target="_blank" rel="noopener noreferrer">
              Get a key
            </a>
            .
          </>
        ) : (
          'Choose a provider to turn on ride briefings, natural-language planning and route discovery. You bring your own key — it stays in this browser.'
        )}
      </p>
    </div>
  );
}

export function ApiKeysSettings() {
  const hydrate = useKeychainStore((s) => s.hydrate);
  const liveApis = useKeychainStore((s) => s.liveApis); // subscribe so the toggle re-renders
  const setLiveApis = useKeychainStore((s) => s.setLiveApis);
  const orsSet = useKeychainStore((s) => Boolean(s.keys.ors)); // subscribe for reactivity
  // A key from EITHER the box here or the build-time env fallback counts — don't nag when routing works.
  const hasRouting = orsSet || routingKeyAvailable();
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
      {live && !hasRouting ? (
        <p className="wr-muted">Live mode is on but no routing key is set — add one below.</p>
      ) : null}

      {API_KEY_NAMES.filter((name) => name !== 'ai').map((name) => (
        <KeyRow key={name} meta={KEY_META[name]} />
      ))}

      <AiProviderPicker />
      <KeyRow meta={KEY_META.ai} />
    </div>
  );
}
