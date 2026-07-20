// state/nlPlanStore.ts — natural-language planning orchestration (WR-046).
// The UI never touches adapters (ARCHITECTURE §3); this store owns the getAiClient() call, validates
// + clamps the reply (engine/nlPlan.parseNlPlan) using the rider's calibrated speed model, and
// APPLIES the clamped patch to the plan inputs via usePlanStore.setInput. The user still reviews the
// filled controls (the changed ones are surfaced) and taps Plan — nothing runs automatically.
import { create } from 'zustand';
import type { AiClient } from '../adapters/ai';
import { getAiClient } from '../adapters/registry';
import { nlPlanRequest, parseNlPlan, type NlPlanPatch } from '../engine/nlPlan';
import { AI_NOT_SET_UP, aiFailureReason } from './aiMessages';
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
      set({ status: 'error', summary: null, changed: [], error: AI_NOT_SET_UP });
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
      // Shared cause-naming copy (WR-050) so auth/quota/network don't read as "rephrase".
      set({
        status: 'error',
        summary: null,
        changed: [],
        error: aiFailureReason(e, 'read that into plan settings'),
      });
    }
  },

  reset: () => set({ status: 'idle', summary: null, changed: [], error: null }),
}));
