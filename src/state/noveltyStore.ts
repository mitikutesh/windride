// state/noveltyStore.ts — the ridden-roads set for the Novelty sub-score (WR-028).
// idb is the source of truth; this store mirrors it in memory (hydrated once) so scoring is sync.
import { create } from 'zustand';
import { addRiddenEdges, clearRiddenEdges, loadRiddenEdges } from '../data/db';
import { trackEdges, uniqueKm } from '../engine/novelty';
import type { GpxPoint } from '../utils/gpx';

interface NoveltyState {
  riddenEdges: Set<string>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Merge a FINISHED recording's edges (recordings only — never planned-but-unridden routes). */
  recordRide: (points: GpxPoint[]) => Promise<void>;
  reset: () => Promise<void>;
  uniqueKm: () => number;
}

export const useNoveltyStore = create<NoveltyState>((set, get) => ({
  riddenEdges: new Set(),
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      set({ riddenEdges: await loadRiddenEdges(), hydrated: true });
    } catch {
      /* idb unavailable (tests/SSR) — novelty simply stays empty (off) */
    }
  },
  recordRide: async (points) => {
    const edges = trackEdges(points);
    if (edges.size === 0) return;
    try {
      await addRiddenEdges(edges);
      set((s) => {
        const next = new Set(s.riddenEdges);
        for (const e of edges) next.add(e);
        return { riddenEdges: next };
      });
    } catch {
      /* best-effort — a failed persist just means those roads aren't remembered yet */
    }
  },
  reset: async () => {
    try {
      await clearRiddenEdges();
    } catch {
      /* best-effort */
    }
    set({ riddenEdges: new Set() });
  },
  uniqueKm: () => uniqueKm(get().riddenEdges),
}));

/** The ridden set scoring should use right now (WR-028). Hydrate via the store on app mount. */
export function activeRiddenEdges(): ReadonlySet<string> {
  return useNoveltyStore.getState().riddenEdges;
}
