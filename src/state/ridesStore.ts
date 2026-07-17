// state/ridesStore.ts — recorded ride history for the Ride screen (WR-017).
import { create } from 'zustand';
import { deleteRide, listRides, type RecordedRide } from '../data/db';

interface RidesState {
  rides: RecordedRide[];
  error: string | null;
  refresh: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useRidesStore = create<RidesState>((set, get) => ({
  rides: [],
  error: null,
  refresh: async () => {
    try {
      set({ rides: (await listRides()).filter((r) => r.status === 'finished'), error: null });
    } catch {
      set({ error: 'Could not load ride history' });
    }
  },
  remove: async (id) => {
    await deleteRide(id);
    await get().refresh();
  },
}));
