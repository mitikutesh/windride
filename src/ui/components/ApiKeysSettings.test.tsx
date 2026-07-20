import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiKeysSettings } from './ApiKeysSettings';
import { useKeychainStore } from '../../state/keychainStore';

beforeEach(async () => {
  vi.stubEnv('VITE_LIVE_APIS', 'false'); // deterministic build default, independent of .env(.test)
  useKeychainStore.setState({ keys: {}, liveApis: null, aiProvider: null, hydrated: true }); // skip idb
  await useKeychainStore.getState().setLiveApis(null); // also clears the registry live override
});
afterEach(() => vi.unstubAllEnvs());

describe('ApiKeysSettings', () => {
  it('renders a row for each key plus the AI provider picker', () => {
    render(<ApiKeysSettings />);
    expect(screen.getByLabelText(/Routing/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Transit/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/AI provider/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/AI key/i)).toBeInTheDocument();
  });

  it('choosing an AI provider stores the per-user choice', async () => {
    render(<ApiKeysSettings />);
    fireEvent.change(screen.getByLabelText(/AI provider/i), { target: { value: 'anthropic' } });
    await waitFor(() => expect(useKeychainStore.getState().aiProvider).toBe('anthropic'));
  });

  it('saves a typed key into the store', async () => {
    render(<ApiKeysSettings />);
    fireEvent.change(screen.getByLabelText(/Routing/i), { target: { value: 'ORS-KEY' } });
    fireEvent.click(screen.getAllByRole('button', { name: /^Save$/i })[0]);
    await waitFor(() => expect(useKeychainStore.getState().keys.ors).toBe('ORS-KEY'));
  });

  it('the live-APIs toggle sets an explicit override', async () => {
    render(<ApiKeysSettings />);
    fireEvent.click(screen.getByRole('switch', { name: /Use live APIs/i }));
    await waitFor(() => expect(useKeychainStore.getState().liveApis).toBe(true));
  });

  it('does not warn about a missing routing key when the env fallback provides one', async () => {
    vi.stubEnv('VITE_ORS_API_KEY', 'env-fallback');
    await useKeychainStore.getState().setLiveApis(true);
    render(<ApiKeysSettings />);
    expect(screen.queryByText(/no routing key is set/i)).not.toBeInTheDocument();
  });

  it('warns when live is on and no routing key exists from any source', async () => {
    vi.stubEnv('VITE_ORS_API_KEY', ''); // no env fallback either
    await useKeychainStore.getState().setLiveApis(true);
    render(<ApiKeysSettings />);
    expect(screen.getByText(/no routing key is set/i)).toBeInTheDocument();
  });
});
