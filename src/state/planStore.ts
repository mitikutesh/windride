// state/planStore.ts — Plan screen inputs, live conditions, and the generate action (WR-008).
// Inputs persist across reload via idb; the pipeline runs on mocks or live per VITE_LIVE_APIS.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getProviders, getTransitProvider } from '../adapters/registry';
import {
  isBrowserOffline,
  isProviderError,
  type ProviderError,
  type ProviderErrorKind,
} from '../adapters/errors';
import { idbStateStorage } from './persist';
import { useResultsStore } from './resultsStore';
import { runPlan, type Conditions, type PlanInputs, type PlanProgress } from './plan/runPlan';
import { runDownwindPlan, type DownwindResult } from './plan/runDownwindPlan';

export type PlanStatus = 'idle' | 'locating' | 'loading' | 'ready' | 'error';
export interface PlanError {
  kind: ProviderErrorKind;
  message: string;
}

/**
 * How the start point was set (WR-051 stale-start fix). 'default'/'geo' starts are ephemeral —
 * every new plan re-fetches the CURRENT location so riding somewhere new never plans from where
 * you were yesterday. Only a hand-typed ('manual') start is sticky.
 */
export type StartSource = 'default' | 'geo' | 'manual';

interface PlanState {
  inputs: PlanInputs;
  conditions: Conditions | null;
  status: PlanStatus;
  progress: string;
  error: PlanError | null;
  startSource: StartSource;
  /** Ranked downwind one-ways (WR-026), shown inline on the Plan screen. */
  downwind: DownwindResult[];
  setInput: (patch: Partial<PlanInputs>) => void;
  /** Resolves true when a position was adopted, false on denial/timeout/unsupported. */
  locate: (opts?: { timeoutMs?: number; maximumAgeMs?: number }) => Promise<boolean>;
  loadConditions: () => Promise<void>;
  generate: () => Promise<void>;
}

// Default start: central Espoo, so the app is demoable offline before geolocation resolves.
export const DEFAULT_START = { lat: 60.17, lon: 24.65 };
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

/**
 * Honest, actionable copy for a plan failure — names the likely cause + fix instead of a blanket
 * "you're offline" (a bad/missing ORS key must never masquerade as a connection problem).
 * Exported for tests; mirrors aiFailureReason / ridesStore.stravaFailureReason.
 */
export function planFailureReason(e: ProviderError): string {
  if (e.code === 'roundtrip-cap') return 'That distance is above the 100 km round-trip limit.';
  if (e.code === 'no-key') {
    return 'Live routing needs an openrouteservice API key — add yours in Kit → API keys.';
  }
  if (e.code === 'auth') {
    return 'openrouteservice rejected your API key. Double-check it in Kit → API keys — a stray space, a typo, or a key that isn’t activated yet are the usual culprits.';
  }
  if (e.code === 'timeout') {
    return 'The routing/weather service took too long to answer. Try again in a moment.';
  }
  switch (e.kind) {
    case 'quota':
      return 'Daily forecast/route limit reached — please try again later.';
    case 'network':
      // Only claim "offline" when the browser actually is; a blocked request while online is
      // more often a rejected key (CORS-blocked 401/403) than a connection problem.
      return e.code === 'offline' || isBrowserOffline()
        ? 'You appear to be offline. Check your connection and try again.'
        : 'Couldn’t reach the service even though you seem to be online. If you just added an API key it may be invalid — check it in Kit → API keys, then try again.';
    default:
      return `The routing/weather service returned something unexpected${e.message ? ` (${e.message})` : ''}.`;
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
      startSource: 'default',
      downwind: [],

      // Any input change invalidates the shown downwind results (they were for the old wind/distance).
      // A patch that touches `start` is a deliberate hand-set start — mark it manual so auto-locate
      // stops clobbering it (typed coords, NL "start from X", …).
      setInput: (patch) =>
        set((s) => ({
          inputs: { ...s.inputs, ...patch },
          downwind: [],
          ...(patch.start ? { startSource: 'manual' as const } : {}),
        })),

      locate: (opts) =>
        new Promise<boolean>((resolve) => {
          if (typeof navigator === 'undefined' || !navigator.geolocation) {
            resolve(false);
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
                startSource: 'geo',
                status: 'idle',
              }));
              resolve(true);
            },
            () => {
              set({ status: 'idle' }); // keep the previous start on failure
              resolve(false);
            },
            {
              timeout: opts?.timeoutMs ?? 8000,
              // Default 0 = always take a fresh reading; generate() opts into a short maximumAge
              // so a seconds-old fix is reused instead of stalling the plan on a new GPS lock.
              maximumAge: opts?.maximumAgeMs ?? 0,
            },
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
                feelsC: c.feelsC,
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
        // Every NEW plan starts from where the rider is NOW (WR-051): refresh geolocation first
        // unless the start was set by hand. Failure/denial falls back to the stored start.
        if (get().startSource !== 'manual') {
          await get().locate({ timeoutMs: 5000, maximumAgeMs: 60_000 });
        }
        // Downwind is its own pipeline (one-way point-to-point + transit return, WR-026) and its
        // results render inline on the Plan screen rather than the loop Results grid.
        if (get().inputs.routeType === 'downwind') {
          set({
            status: 'loading',
            error: null,
            progress: 'Finding downwind stations…',
            downwind: [],
          });
          try {
            const { start, distanceKm, surface, departureHour } = get().inputs;
            const results = await runDownwindPlan(
              getProviders(),
              { start, distanceKm, surface, departureHour },
              { now: Date.now(), transit: getTransitProvider() },
            );
            if (results.length === 0) {
              set({
                status: 'error',
                progress: '',
                error: {
                  kind: 'badResponse',
                  message:
                    'No transit stations sit downwind at this distance today. Try a different distance, or loop/out-and-back mode.',
                },
              });
              return;
            }
            set({ downwind: results, status: 'ready', progress: '' });
          } catch (e) {
            const error: PlanError = isProviderError(e)
              ? { kind: e.kind, message: planFailureReason(e) }
              : { kind: 'network', message: (e as Error).message ?? 'Something went wrong.' };
            set({ status: 'error', error, progress: '' });
          }
          return;
        }

        set({ status: 'loading', error: null, progress: 'Drafting candidates…' });
        try {
          const out = await runPlan(getProviders(), get().inputs, {
            now: Date.now(),
            onProgress: (p) => set({ progress: progressText(p) }),
          });
          if (out.ranked.length === 0) {
            // Candidates were generated but all failed the hard constraints — surface why, and
            // keep any previous results rather than wiping them with an empty set.
            const reason = out.rejected[0]?.reasons[0] ?? 'no routes matched your constraints';
            set({
              conditions: out.conditions,
              status: 'error',
              progress: '',
              error: {
                kind: 'badResponse',
                message: `No routes met your constraints (${reason}). Try a different distance or turn off Home before dark.`,
              },
            });
            return;
          }
          useResultsStore.getState().setResults({
            ranked: out.ranked,
            rejected: out.rejected,
            shelterDataAvailable: out.shelterDataAvailable,
            startMatrix: out.startMatrix,
            startMessage: out.startMessage,
            hourLabels: out.hourLabels,
            winter: out.winter,
          });
          set({ conditions: out.conditions, status: 'ready', progress: '' });
          if (typeof window !== 'undefined') {
            window.location.hash = '#/results';
          }
        } catch (e) {
          const error: PlanError = isProviderError(e)
            ? { kind: e.kind, message: planFailureReason(e) }
            : { kind: 'network', message: (e as Error).message ?? 'Something went wrong.' };
          set({ status: 'error', error, progress: '' });
        }
      },
    }),
    {
      name: 'windride-plan',
      storage: createJSONStorage(() => idbStateStorage),
      // startSource persists with the inputs; pre-WR-051 stores lack it and hydrate as 'default',
      // so their (possibly stale) persisted start gets refreshed on the next visit/plan.
      partialize: (s) => ({ inputs: s.inputs, startSource: s.startSource }),
    },
  ),
);
