import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MissingKeyBanner } from './MissingKeyBanner';
import { useKeychainStore } from '../../state/keychainStore';

beforeEach(async () => {
  vi.stubEnv('VITE_LIVE_APIS', 'false');
  vi.stubEnv('VITE_ORS_API_KEY', '');
  useKeychainStore.setState({ keys: {}, liveApis: null, hydrated: true });
  await useKeychainStore.getState().setLiveApis(null);
});
afterEach(() => vi.unstubAllEnvs());

describe('MissingKeyBanner', () => {
  it('is hidden in mock mode (no live routing needed)', () => {
    render(<MissingKeyBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows, linking to Kit, when live is on and no routing key exists anywhere', async () => {
    await useKeychainStore.getState().setLiveApis(true);
    render(<MissingKeyBanner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add your key/i })).toHaveAttribute('href', '#/kit');
  });

  it('is hidden when live is on but the env fallback provides a routing key', async () => {
    vi.stubEnv('VITE_ORS_API_KEY', 'env-key');
    await useKeychainStore.getState().setLiveApis(true);
    render(<MissingKeyBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('is hidden once the user has saved their own routing key', async () => {
    await useKeychainStore.getState().setLiveApis(true);
    useKeychainStore.setState({ keys: { ors: 'user-key' } });
    render(<MissingKeyBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
