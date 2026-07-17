// state/resultsStore.ts — ranked candidates for the Results screen (WR-008 populates, WR-009 renders).
import { create } from 'zustand';
import type { RejectedCandidate, ScoredCandidate, StartTimeMatrix } from '../engine/scoring';

interface ResultsState {
  ranked: ScoredCandidate[];
  rejected: RejectedCandidate[];
  selectedId: string | null;
  /** False when no exposure/shelter data covered the routes (WR-019) — shown as a note. */
  shelterDataAvailable: boolean;
  /** Start-time optimizer output (WR-020). */
  startMatrix: StartTimeMatrix | null;
  startMessage: string;
  hourLabels: string[];
  setResults: (r: {
    ranked: ScoredCandidate[];
    rejected: RejectedCandidate[];
    shelterDataAvailable?: boolean;
    startMatrix?: StartTimeMatrix | null;
    startMessage?: string;
    hourLabels?: string[];
  }) => void;
  select: (id: string) => void;
  clear: () => void;
}

export const useResultsStore = create<ResultsState>((set) => ({
  ranked: [],
  rejected: [],
  selectedId: null,
  shelterDataAvailable: false,
  startMatrix: null,
  startMessage: '',
  hourLabels: [],
  setResults: ({
    ranked,
    rejected,
    shelterDataAvailable = false,
    startMatrix = null,
    startMessage = '',
    hourLabels = [],
  }) =>
    set({
      ranked,
      rejected,
      shelterDataAvailable,
      startMatrix,
      startMessage,
      hourLabels,
      selectedId: ranked[0]?.candidate.id ?? null,
    }),
  select: (id) => set({ selectedId: id }),
  clear: () =>
    set({
      ranked: [],
      rejected: [],
      selectedId: null,
      shelterDataAvailable: false,
      startMatrix: null,
      startMessage: '',
      hourLabels: [],
    }),
}));
