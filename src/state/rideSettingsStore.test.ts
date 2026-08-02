import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultMapOrientation, useRideSettingsStore } from './rideSettingsStore';

afterEach(() => {
  vi.unstubAllGlobals();
  useRideSettingsStore.setState({ mapOrientation: 'heading-up' });
});

describe('defaultMapOrientation', () => {
  it('defaults to heading-up — the mode that fixes left/right confusion', () => {
    // Node has no window at all, which is also the "no preference expressed" case.
    expect(defaultMapOrientation()).toBe('heading-up');
  });

  it('defaults to north-up when the rider has asked the OS for reduced motion', () => {
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({ matches: q.includes('prefers-reduced-motion') }),
    });
    expect(defaultMapOrientation()).toBe('north-up');
  });

  it('treats a browser without matchMedia as no preference rather than throwing', () => {
    vi.stubGlobal('window', {});
    expect(defaultMapOrientation()).toBe('heading-up');
  });
});

describe('useRideSettingsStore', () => {
  it('toggles between the two orientations', () => {
    const { toggleMapOrientation } = useRideSettingsStore.getState();
    toggleMapOrientation();
    expect(useRideSettingsStore.getState().mapOrientation).toBe('north-up');
    toggleMapOrientation();
    expect(useRideSettingsStore.getState().mapOrientation).toBe('heading-up');
  });

  it('sets an orientation directly', () => {
    useRideSettingsStore.getState().setMapOrientation('north-up');
    expect(useRideSettingsStore.getState().mapOrientation).toBe('north-up');
  });
});
