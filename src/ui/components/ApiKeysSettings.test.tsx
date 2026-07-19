import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiKeysSettings } from './ApiKeysSettings';
import { useKeychainStore } from '../../state/keychainStore';

beforeEach(async () => {
  useKeychainStore.setState({ keys: {}, liveApis: null, hydrated: true }); // skip idb hydrate
  await useKeychainStore.getState().setLiveApis(null); // also clears the registry live override
});

describe('ApiKeysSettings', () => {
  it('renders a row for each key, including the reserved AI slot', () => {
    render(<ApiKeysSettings />);
    expect(screen.getByLabelText(/Routing/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Transit/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/AI key/i)).toBeInTheDocument();
    expect(screen.getAllByText(/reserved/i).length).toBeGreaterThan(0);
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
});
