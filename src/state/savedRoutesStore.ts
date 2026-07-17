// state/savedRoutesStore.ts — saved planned routes (WR-010). UI reads this; it owns the idb calls.
import { create } from 'zustand';
import { deleteRoute, listRoutes, saveRoute, type SavedRoute } from '../data/db';

interface SavedRoutesState {
  routes: SavedRoute[];
  refresh: () => Promise<void>;
  save: (route: SavedRoute) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useSavedRoutesStore = create<SavedRoutesState>((set, get) => ({
  routes: [],
  refresh: async () => {
    try {
      set({ routes: await listRoutes() });
    } catch {
      /* idb unavailable — leave the list empty */
    }
  },
  save: async (route) => {
    await saveRoute(route);
    await get().refresh();
  },
  remove: async (id) => {
    await deleteRoute(id);
    await get().refresh();
  },
}));
