// state/rideSettingsStore.ts — saddle-UI preferences that must survive a ride (WR-053).
//
// Currently just the map orientation. It is persisted because the rider sets it once, on the bike,
// and re-toggling it at the start of every ride would be the opposite of helpful. (The basemap and
// battery-saver toggles are still per-session local state; this store is the natural home if they
// should be remembered too — a follow-up, not this story.)
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { idbStateStorage } from './persist';

/** 'heading-up' rotates the map so up = travel direction; 'north-up' is the classic fixed map. */
export type MapOrientation = 'heading-up' | 'north-up';

/**
 * A rotating map is a known vestibular trigger, so a rider who has asked the OS for less motion
 * starts north-up and can still opt in explicitly. Guarded for node (tests have no matchMedia).
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function defaultMapOrientation(): MapOrientation {
  return prefersReducedMotion() ? 'north-up' : 'heading-up';
}

interface RideSettingsState {
  mapOrientation: MapOrientation;
  setMapOrientation: (o: MapOrientation) => void;
  toggleMapOrientation: () => void;
}

export const useRideSettingsStore = create<RideSettingsState>()(
  persist(
    (set) => ({
      mapOrientation: defaultMapOrientation(),
      setMapOrientation: (mapOrientation) => set({ mapOrientation }),
      toggleMapOrientation: () =>
        set((s) => ({
          mapOrientation: s.mapOrientation === 'heading-up' ? 'north-up' : 'heading-up',
        })),
    }),
    {
      name: 'windride-ride-settings',
      version: 1,
      storage: createJSONStorage(() => idbStateStorage),
      partialize: (s) => ({ mapOrientation: s.mapOrientation }),
    },
  ),
);
