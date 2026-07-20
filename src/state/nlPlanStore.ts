// state/nlPlanStore.ts — natural-language planning orchestration (WR-046).
// The UI never touches adapters (ARCHITECTURE §3); this store owns the getAiClient() call, validates
// + clamps the reply (engine/nlPlan.parseNlPlan) using the rider's calibrated speed model, and
// APPLIES the clamped patch to the plan inputs via usePlanStore.setInput. The user still reviews the
// filled controls (the changed ones are surfaced) and taps Plan — nothing runs automatically.
import { create } from 'zustand';
import type { AiClient } from '../adapters/ai';
import { isProviderError } from '../adapters/errors';
import { getAiClient } from '../adapters/registry';
import { nlPlanRequest, parseNlPlan, type NlPlanPatch } from '../engine/nlPlan';
import { activeSpeedSettings } from './calibrationStore';
import { usePlanStore } from './planStore';

type Status = 'idle' | 'loading' | 'ready' | 'error';

/** Human labels for the fields the AI can fill — shown as chips so the user sees what changed. */
const FIELD_LABELS: Record<keyof NlPlanPatch, string> = {
  distanceKm: 'Distance',
  routeType: 'Shape',
  surface: 'Surface',
  homeBeforeDark: 'Home before dark',
  avoidBusy: 'Avoid busy roads',
  winter: 'Winter mode',
  departureHour: 'Departure time',
};

interface NlPlanState {
  status: Status;
  /** What the AI understood, echoed back so the user can sanity-check before planning. */
  summary: string | null;
  /** Human labels of the settings that changed, so they stand out among the untouched controls. */
  changed: string[];
  error: string | null;
  interpret: (text: string, client?: AiClient) => Promise<void>;
  reset: () => void;
}

export const useNlPlanStore = create<NlPlanState>((set) => ({
  status: 'idle',
  summary: null,
  changed: [],
  error: null,

  interpret: async (text, injected) => {
    if (text.trim().length === 0) return;
    const client = injected ?? getAiClient();
    if (!client) {
      set({ status: 'error', summary: null, changed: [], error: 'AI is not set up.' });
      return;
    }
    set({ status: 'loading', error: null, summary: null, changed: [] });
    try {
      // Duration→distance conversion uses the rider's calibrated base speeds (DEC-004 defaults if
      // uncalibrated); 'road' maps to the model's 'paved' surface.
      const ss = activeSpeedSettings();
      const speeds = { roadKmh: ss.baseKmh.paved, gravelKmh: ss.baseKmh.gravel };
      const nl = await client.complete(nlPlanRequest(text), (raw) => parseNlPlan(raw, speeds));
      // Apply the clamped patch to the plan inputs; the user reviews + taps Plan themselves.
      usePlanStore.getState().setInput(nl.patch);
      const changed = (Object.keys(nl.patch) as Array<keyof NlPlanPatch>).map(
        (k) => FIELD_LABELS[k],
      );
      const summary = nl.summary || `Updated ${changed.length} setting(s) from your description.`;
      set({ status: 'ready', summary, changed, error: null });
    } catch (e) {
      // Phrase by failure kind so an auth/quota problem doesn't send the user into a rewording
      // loop (WR-050 will centralise this). A validation failure falls through to the rephrase copy.
      let error = "Couldn't read that into plan settings. Try rephrasing, or set them by hand.";
      if (isProviderError(e)) {
        if (e.code === 'auth') error = 'Your AI key was rejected — check it in Kit → AI.';
        else if (e.kind === 'quota') error = 'AI limit reached — please try again later.';
        else if (e.kind === 'network') error = 'You appear to be offline. Check your connection.';
      }
      set({ status: 'error', summary: null, changed: [], error });
    }
  },

  reset: () => set({ status: 'idle', summary: null, changed: [], error: null }),
}));
