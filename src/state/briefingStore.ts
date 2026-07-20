// state/briefingStore.ts — AI ride briefing orchestration (WR-045).
// The UI never touches adapters (ARCHITECTURE §3); this store owns the getAiClient() call, feeds it
// the engine's grounded facts, validates the reply (parseBriefing), and exposes a plain status
// machine. One briefing at a time, tagged by routeId so a stale briefing never shows for a route the
// user has since switched away from.
import { create } from 'zustand';
import type { AiClient } from '../adapters/ai';
import { getAiClient } from '../adapters/registry';
import {
  briefingRequest,
  buildBriefingFacts,
  parseBriefing,
  type Briefing,
  type BriefingConditions,
  type BriefingWinter,
} from '../engine/briefing';
import type { ScoredCandidate } from '../engine/scoring';

type Status = 'idle' | 'loading' | 'ready' | 'error';

/** Options for a briefing run. `client` is injectable so tests never touch the network. */
export interface GenerateOptions {
  /** Hours from now the ride departs (from the plan inputs) — sets the daylight margin correctly. */
  departureHour?: number;
  client?: AiClient;
}

interface BriefingState {
  status: Status;
  briefing: Briefing | null;
  error: string | null;
  /** The route id the current briefing/loading state belongs to. */
  routeId: string | null;
  generate: (
    scored: ScoredCandidate,
    cond: BriefingConditions,
    winter: BriefingWinter | null,
    opts?: GenerateOptions,
  ) => Promise<void>;
  reset: () => void;
}

export const useBriefingStore = create<BriefingState>((set, get) => ({
  status: 'idle',
  briefing: null,
  error: null,
  routeId: null,

  generate: async (scored, cond, winter, opts) => {
    const client = opts?.client ?? getAiClient();
    const id = scored.candidate.id;
    if (!client) {
      // AI isn't set up — the UI already hides the entry point, so this is a defensive no-op.
      set({ status: 'error', error: 'AI is not set up.', briefing: null, routeId: id });
      return;
    }
    set({ status: 'loading', error: null, briefing: null, routeId: id });
    try {
      const rideStartMs = Date.now() + (opts?.departureHour ?? 0) * 3_600_000;
      const facts = buildBriefingFacts(scored, cond, rideStartMs, winter);
      const briefing = await client.complete(briefingRequest(facts), parseBriefing);
      if (get().routeId !== id) return; // user switched routes mid-flight — drop this stale result
      set({ status: 'ready', briefing, error: null });
    } catch {
      // Any failure (network/quota/malformed) → a plain retry state, never a raw error (DEC-043).
      if (get().routeId !== id) return;
      set({
        status: 'error',
        error: 'Couldn’t get a briefing. Tap the button to try again.',
        briefing: null,
      });
    }
  },

  reset: () => set({ status: 'idle', briefing: null, error: null, routeId: null }),
}));
