// state/planStore.ts — Plan screen inputs, live conditions, and the generate action (WR-008).
// Inputs persist across reload via idb; the pipeline runs on mocks or live per VITE_LIVE_APIS.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getProviders } from '../adapters/registry';
import { isProviderError, type ProviderError, type ProviderErrorKind } from '../adapters/errors';
import { idbStateStorage } from './persist';
import { useResultsStore } from './resultsStore';
import { runPlan, type Conditions, type PlanInputs, type PlanProgress } from './plan/runPlan';

export type PlanStatus = 'idle' | 'locating' | 'loading' | 'ready' | 'error';
export interface PlanError {
  kind: ProviderErrorKind;
  message: string;
}

interface PlanState {
  inputs: PlanInputs;
  conditions: Conditions | null;
  status: PlanStatus;
  progress: string;
  error: PlanError | null;
  setInput: (patch: Partial<PlanInputs>) => void;
  locate: () => Promise<void>;
  loadConditions: () => Promise<void>;
  generate: () => Promise<void>;
}

// Default start: central Espoo, so the app is demoable offline before geolocation resolves.
const DEFAULT_START = { lat: 60.17, lon: 24.65 };
const DEFAULT_INPUTS: PlanInputs = {
  distanceKm: 50,
  routeType: 'loop',
  surface: 'gravel',
  homeBeforeDark: false,
  avoidBusy: false,
  start: DEFAULT_START,
};

function progressText(p: PlanProgress): string {
  if (p.phase === 'candidates') {
    return p.total > 0 ? `Drafting candidates ${p.done}/${p.total}…` : 'Drafting candidates…';
  }
  return p.phase === 'weather' ? 'Reading the wind…' : 'Scoring routes…';
}

function phrase(e: ProviderError): string {
  if (e.code === 'roundtrip-cap') return 'That distance is above the 100 km round-trip limit.';
  switch (e.kind) {
    case 'quota':
      return 'Daily forecast/route limit reached — please try again later.';
    case 'network':
      return 'You appear to be offline. Check your connection and try again.';
    default:
      return 'The routing/weather service returned something unexpected.';
  }
}

export const usePlanStore = create<PlanState>()(
  persist(
    (set, get) => ({
      inputs: DEFAULT_INPUTS,
      conditions: null,
      status: 'idle',
      progress: '',
      error: null,

      setInput: (patch) => set((s) => ({ inputs: { ...s.inputs, ...patch } })),

      locate: () =>
        new Promise<void>((resolve) => {
          if (typeof navigator === 'undefined' || !navigator.geolocation) {
            resolve();
            return;
          }
          set({ status: 'locating' });
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              set((s) => ({
                inputs: {
                  ...s.inputs,
                  start: { lat: pos.coords.latitude, lon: pos.coords.longitude },
                },
                status: 'idle',
              }));
              resolve();
            },
            () => {
              set({ status: 'idle' }); // keep the default start on failure
              resolve();
            },
            { timeout: 8000 },
          );
        }),

      loadConditions: async () => {
        try {
          const providers = getProviders();
          const start = get().inputs.start;
          const hourly = (await providers.weather.windAlong([start], 1))[0] ?? [];
          const daylight = await providers.weather.daylight(start);
          const c = hourly[0];
          if (c) {
            set({
              conditions: {
                windMs: c.windMs,
                windFromDeg: c.windFromDeg,
                gustMs: c.gustMs,
                tempC: c.tempC,
                precipProb: c.precipProb,
                sunset: daylight.sunset,
                sunrise: daylight.sunrise,
              },
            });
          }
        } catch {
          /* the conditions strip simply stays empty; non-fatal */
        }
      },

      generate: async () => {
        set({ status: 'loading', error: null, progress: 'Drafting candidates…' });
        try {
          const out = await runPlan(getProviders(), get().inputs, {
            now: Date.now(),
            onProgress: (p) => set({ progress: progressText(p) }),
          });
          useResultsStore.getState().setResults({ ranked: out.ranked, rejected: out.rejected });
          set({ conditions: out.conditions, status: 'ready', progress: '' });
          if (out.ranked.length > 0 && typeof window !== 'undefined') {
            window.location.hash = '#/results';
          }
        } catch (e) {
          const error: PlanError = isProviderError(e)
            ? { kind: e.kind, message: phrase(e) }
            : { kind: 'network', message: (e as Error).message ?? 'Something went wrong.' };
          set({ status: 'error', error, progress: '' });
        }
      },
    }),
    {
      name: 'windride-plan',
      storage: createJSONStorage(() => idbStateStorage),
      partialize: (s) => ({ inputs: s.inputs }),
    },
  ),
);
