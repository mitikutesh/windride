// state/calibrationStore.ts — speed-model calibration from recorded rides (WR-024, SCORING_SPEC §3).
//
// At each ride finish the ride is bucketed against its planned analysis and merged into a persisted
// accumulator (aggregates only — never raw points). Once ENOUGH_RIDES rides are in, Settings can
// fit a calibrated model and show its before/after ETA error; the owner APPLIES it explicitly —
// planning never swaps the model silently (acceptance: "no silent changes").
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  bucketObservations,
  bucketsToObservations,
  etaErrorForModel,
  fitSpeedModel,
  mergeBuckets,
  toSpeedSettings,
  type CalibratedModel,
  type CalibrationBucket,
  type CalibrationResult,
} from '../engine/calibration';
import { DEFAULT_SPEED_SETTINGS, type SpeedSettings } from '../engine/speedModel';
import type { CandidateAnalysis } from '../engine/scoring';
import { observationsFromRide } from '../nav/rideCalibration';
import type { GpxPoint } from '../utils/gpx';
import { idbStateStorage } from './persist';

/** Rides needed before a fit is offered (acceptance: "after ≥5 rides"). */
export const ENOUGH_RIDES = 5;
/** How many recent per-ride ETA errors to keep for the trend display. */
const ETA_HISTORY = 20;

export interface CalibrationProposal {
  result: CalibrationResult;
  beforeErrorPct: number;
  afterErrorPct: number;
}

interface CalibrationState {
  buckets: CalibrationBucket[];
  rideCount: number;
  /** Recent per-ride full-ride ETA errors (%), newest last. */
  etaErrors: number[];
  /** The currently applied calibrated model, or null for the default model. */
  applied: CalibratedModel | null;
  recordRide: (
    analysis: CandidateAnalysis,
    points: GpxPoint[],
    predictedMovingS: number,
    actualMovingS: number,
  ) => void;
  proposal: () => CalibrationProposal | null;
  apply: (model: CalibratedModel) => void;
  clearApplied: () => void;
  resetData: () => void;
}

/** ETA error the plain default model scored on the recorded buckets — the "before" baseline. */
function defaultModel(): CalibratedModel {
  return {
    v0Paved: DEFAULT_SPEED_SETTINGS.baseKmh.paved,
    v0Gravel: DEFAULT_SPEED_SETTINGS.baseKmh.gravel,
    kTail: DEFAULT_SPEED_SETTINGS.tailCoef,
    kHead: DEFAULT_SPEED_SETTINGS.headCoef,
  };
}

/**
 * Fit a proposal from the banked buckets, or null if there aren't enough rides yet. Pure and
 * exported so the Settings panel can memoize on (buckets, rideCount) without reaching into `get()`.
 */
export function computeProposal(
  buckets: CalibrationBucket[],
  rideCount: number,
): CalibrationProposal | null {
  if (rideCount < ENOUGH_RIDES) return null;
  const obs = bucketsToObservations(buckets);
  if (obs.length === 0) return null;
  const result = fitSpeedModel(obs, DEFAULT_SPEED_SETTINGS);
  return {
    result,
    beforeErrorPct: etaErrorForModel(buckets, defaultModel(), DEFAULT_SPEED_SETTINGS),
    afterErrorPct: etaErrorForModel(buckets, result.model, DEFAULT_SPEED_SETTINGS),
  };
}

export const useCalibrationStore = create<CalibrationState>()(
  persist(
    (set, get) => ({
      buckets: [],
      rideCount: 0,
      etaErrors: [],
      applied: null,

      recordRide: (analysis, points, predictedMovingS, actualMovingS) => {
        const obs = observationsFromRide(analysis, points);
        // A ride with no on-route paved/gravel motion contributes nothing — don't count it.
        if (obs.length === 0) return;
        const errorPct =
          actualMovingS > 0
            ? (Math.abs(predictedMovingS - actualMovingS) / actualMovingS) * 100
            : 0;
        set((s) => ({
          buckets: mergeBuckets(s.buckets, bucketObservations(obs)),
          rideCount: s.rideCount + 1,
          etaErrors: [...s.etaErrors, errorPct].slice(-ETA_HISTORY),
        }));
      },

      proposal: () => {
        const { buckets, rideCount } = get();
        return computeProposal(buckets, rideCount);
      },

      apply: (model) => set({ applied: model }),
      clearApplied: () => set({ applied: null }),
      resetData: () => set({ buckets: [], rideCount: 0, etaErrors: [], applied: null }),
    }),
    {
      name: 'windride-calibration',
      storage: createJSONStorage(() => idbStateStorage),
      partialize: (s) => ({
        buckets: s.buckets,
        rideCount: s.rideCount,
        etaErrors: s.etaErrors,
        applied: s.applied,
      }),
    },
  ),
);

/** The speed settings planning should use right now — the applied calibration, else the default. */
export function activeSpeedSettings(): SpeedSettings {
  const { applied } = useCalibrationStore.getState();
  return applied ? toSpeedSettings(applied, DEFAULT_SPEED_SETTINGS) : DEFAULT_SPEED_SETTINGS;
}
