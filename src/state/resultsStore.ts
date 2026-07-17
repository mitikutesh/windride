// state/resultsStore.ts — ranked candidates for the Results screen (WR-008 populates, WR-009 renders).
import { create } from 'zustand';
import type { RejectedCandidate, ScoredCandidate, StartTimeMatrix } from '../engine/scoring';
import type { WinterInfo } from './plan/runPlan';

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
  /** Winter-mode advisory (WR-027); null outside winter mode. */
  winter: WinterInfo | null;
  setResults: (r: {
    ranked: ScoredCandidate[];
    rejected: RejectedCandidate[];
    shelterDataAvailable?: boolean;
    startMatrix?: StartTimeMatrix | null;
    startMessage?: string;
    hourLabels?: string[];
    winter?: WinterInfo | null;
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
  winter: null,
  setResults: ({
    ranked,
    rejected,
    shelterDataAvailable = false,
    startMatrix = null,
    startMessage = '',
    hourLabels = [],
    winter = null,
  }) =>
    set({
      ranked,
      rejected,
      shelterDataAvailable,
      startMatrix,
      startMessage,
      hourLabels,
      winter,
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
      winter: null,
    }),
}));
