// state/recapStore.ts — post-ride AI summary orchestration (WR-049).
// The UI never touches adapters (ARCHITECTURE §3); this store owns the getAiClient() call, feeds it
// the engine's grounded facts from the rider's OWN recording, validates the reply, and exposes a
// status machine. One recap at a time, tagged by rideId. Own recordings only — never Strava.
import { create } from 'zustand';
import type { AiClient } from '../adapters/ai';
import { getAiClient } from '../adapters/registry';
import type { RideSummary } from '../domain';
import { buildRecapFacts, parseRecap, recapRequest, type Recap } from '../engine/rideRecap';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface RecapState {
  status: Status;
  recap: Recap | null;
  error: string | null;
  rideId: string | null;
  generate: (rideId: string, summary: RideSummary, client?: AiClient) => Promise<void>;
  reset: () => void;
}

// Monotonic request token: only the LATEST generate() may write results, so a slow older request
// (even for the same ride) can never clobber a newer one's success (or vice-versa).
let seq = 0;

export const useRecapStore = create<RecapState>((set) => ({
  status: 'idle',
  recap: null,
  error: null,
  rideId: null,

  generate: async (rideId, summary, injected) => {
    const token = ++seq;
    const client = injected ?? getAiClient();
    if (!client) {
      set({ status: 'error', error: 'AI is not set up.', recap: null, rideId });
      return;
    }
    set({ status: 'loading', error: null, recap: null, rideId });
    try {
      const recap = await client.complete(recapRequest(buildRecapFacts(summary)), parseRecap);
      if (token !== seq) return; // a newer request superseded this one — drop the stale result
      set({ status: 'ready', recap, error: null, rideId });
    } catch {
      if (token !== seq) return;
      set({ status: 'error', error: 'Couldn’t write a recap. Tap to try again.', recap: null });
    }
  },

  reset: () => set({ status: 'idle', recap: null, error: null, rideId: null }),
}));
