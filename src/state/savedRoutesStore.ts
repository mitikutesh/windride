// state/savedRoutesStore.ts — saved planned routes (WR-010). UI reads this; it owns the idb calls.
import { create } from 'zustand';
import { addRouteTombstone, deleteRoute, listRoutes, saveRoute, type SavedRoute } from '../data/db';

interface SavedRoutesState {
  routes: SavedRoute[];
  /** Set when an idb operation fails (private mode / storage pressure) so the UI can notify. */
  error: string | null;
  refresh: () => Promise<void>;
  save: (route: SavedRoute) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useSavedRoutesStore = create<SavedRoutesState>((set, get) => ({
  routes: [],
  error: null,
  refresh: async () => {
    try {
      set({ routes: await listRoutes(), error: null });
    } catch {
      set({ error: 'Could not read saved routes.' });
    }
  },
  save: async (route) => {
    try {
      await saveRoute(route);
      await get().refresh();
    } catch {
      set({ error: 'Could not save the route.' });
    }
  },
  remove: async (id) => {
    try {
      await deleteRoute(id);
      // Tombstone the deletion so a cross-device sync doesn't resurrect the route (WR-041).
      await addRouteTombstone(id, new Date().toISOString());
      await get().refresh();
    } catch {
      set({ error: 'Could not delete the route.' });
    }
  },
}));
