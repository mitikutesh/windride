// state/discoveryStore.ts — AI route discovery orchestration (WR-047).
// Flow: ask the AI for scenic directions → build a real loop toward each bearing with the ROUTER
// (validation: unbuildable ideas are dropped) → score them through the existing engine
// (scoreBuiltRoutes) → publish to the Results grid. The AI never produces geometry or scores; it
// only suggests directions + notes. UI never touches adapters — this store owns the calls.
import { create } from 'zustand';
import type { AiClient } from '../adapters/ai';
import { isProviderError } from '../adapters/errors';
import { generateCandidates } from '../adapters/routing/ors';
import { getAiClient, getProviders, type Providers } from '../adapters/registry';
import { discoveryRequest, parseDiscoveries, type Discovery } from '../engine/discovery';
import { orsProfile } from './plan/profiles';
import type { PlanInputs } from './plan/runPlan';
import { scoreBuiltRoutes } from './plan/scoreRoutes';
import { useResultsStore } from './resultsStore';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export interface DiscoverDeps {
  client?: AiClient;
  providers?: Providers;
  now?: number;
  loadGrid?: Parameters<typeof scoreBuiltRoutes>[3]['loadGrid'];
  /** Navigate to Results on success (defaults to setting the location hash). */
  navigate?: () => void;
}

interface DiscoveryState {
  status: Status;
  /** AI note per discovered candidate id, so Results can show why each route was suggested. */
  notes: Record<string, string>;
  error: string | null;
  discover: (inputs: PlanInputs, deps?: DiscoverDeps) => Promise<void>;
  reset: () => void;
}

function extractBearing(id: string): number | null {
  const m = /ors-oab-(\d+)/.exec(id);
  return m ? Number(m[1]) : null;
}

export const useDiscoveryStore = create<DiscoveryState>((set) => ({
  status: 'idle',
  notes: {},
  error: null,

  discover: async (inputs, deps) => {
    const client = deps?.client ?? getAiClient();
    const providers = deps?.providers ?? getProviders();
    if (!client) {
      set({ status: 'error', error: 'AI is not set up.', notes: {} });
      return;
    }
    set({ status: 'loading', error: null, notes: {} });
    try {
      const area = `${inputs.start.lat.toFixed(3)}, ${inputs.start.lon.toFixed(3)}`;
      const discoveries: Discovery[] = await client.complete(
        discoveryRequest(area, inputs.distanceKm, inputs.surface),
        parseDiscoveries,
      );

      // Build a real loop toward each suggested bearing; the router drops unbuildable ones.
      // Cap to ≤3 UNIQUE bearings (keep-first) to stay under the ORS free-tier budget (WR-047) and
      // to avoid double-billing duplicate bearings; keep-first matches dedupeByOverlap's keep-first
      // so the surviving route's note is the first idea at that bearing, not a mismatched twin.
      const profile = orsProfile(inputs.surface);
      const byBearing = new Map<number, Discovery>();
      const buildBearings: number[] = [];
      for (const d of discoveries) {
        if (byBearing.has(d.bearingDeg)) continue;
        byBearing.set(d.bearingDeg, d);
        if (buildBearings.length < 3) buildBearings.push(d.bearingDeg);
      }
      const routes = await generateCandidates(
        providers.routing,
        inputs.start,
        inputs.distanceKm * 1000,
        profile,
        { seeds: [], pointsVariation: [], bearings: buildBearings },
      );
      if (routes.length === 0) {
        set({
          status: 'error',
          error: "Couldn't build any of the suggested routes here.",
          notes: {},
        });
        return;
      }

      // Re-id with a `disc-` prefix so discovered routes never collide with a normal plan's ids
      // (keeps notes from ever showing against a later non-discovery result), and attach notes.
      const notes: Record<string, string> = {};
      const built = routes.map((r) => {
        const bearing = extractBearing(r.id);
        const d = bearing !== null ? byBearing.get(bearing) : undefined;
        const id = `disc-${bearing ?? r.id}`;
        if (d) notes[id] = `${d.name} — ${d.note}`;
        return { ...r, id };
      });

      const { ranked, rejected, shelterDataAvailable, winter } = await scoreBuiltRoutes(
        providers,
        inputs,
        built,
        { now: deps?.now ?? Date.now(), loadGrid: deps?.loadGrid },
      );
      if (ranked.length === 0) {
        set({
          status: 'error',
          error: 'None of the discovered routes fit your constraints today.',
          notes: {},
        });
        return;
      }

      useResultsStore.getState().setResults({ ranked, rejected, shelterDataAvailable, winter });
      set({ status: 'ready', notes, error: null });
      (
        deps?.navigate ??
        (() => {
          if (typeof window !== 'undefined') window.location.hash = '#/results';
        })
      )();
    } catch (e) {
      let error = "Couldn't discover routes right now. Try again.";
      if (isProviderError(e)) {
        if (e.code === 'auth') error = 'Your AI key was rejected — check it in Kit → AI.';
        else if (e.kind === 'quota')
          error = 'AI or routing limit reached — please try again later.';
        else if (e.kind === 'network') error = 'You appear to be offline. Check your connection.';
      }
      set({ status: 'error', error, notes: {} });
    }
  },

  reset: () => set({ status: 'idle', notes: {}, error: null }),
}));
