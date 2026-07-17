// state/resultsStore.ts — ranked candidates for the Results screen (WR-008 populates, WR-009 renders).
import { create } from 'zustand';
import type { RejectedCandidate, ScoredCandidate } from '../engine/scoring';

interface ResultsState {
  ranked: ScoredCandidate[];
  rejected: RejectedCandidate[];
  selectedId: string | null;
  /** False when no exposure/shelter data covered the routes (WR-019) — shown as a note. */
  shelterDataAvailable: boolean;
  setResults: (r: {
    ranked: ScoredCandidate[];
    rejected: RejectedCandidate[];
    shelterDataAvailable?: boolean;
  }) => void;
  select: (id: string) => void;
  clear: () => void;
}

export const useResultsStore = create<ResultsState>((set) => ({
  ranked: [],
  rejected: [],
  selectedId: null,
  shelterDataAvailable: false,
  setResults: ({ ranked, rejected, shelterDataAvailable = false }) =>
    set({ ranked, rejected, shelterDataAvailable, selectedId: ranked[0]?.candidate.id ?? null }),
  select: (id) => set({ selectedId: id }),
  clear: () => set({ ranked: [], rejected: [], selectedId: null, shelterDataAvailable: false }),
}));
