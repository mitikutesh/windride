// state/curatedStore.ts — "Curated routes near me" orchestration (WR-052).
// Flow: load the static catalog (adapter) → shortlist real routes near the start that fit today's
// distance (pure engine filter) → score them through the SAME engine block as an ordinary plan
// (scoreBuiltRoutes, WR-047) → publish to the Results grid. Nothing here touches a score: the
// catalog supplies geometry and provenance only. UI never calls adapters — this store does.
import { create } from 'zustand';
import { loadCuratedCatalog, type CuratedCatalog } from '../adapters/curatedRoutes';
import { isProviderError } from '../adapters/errors';
import { getProviders, type Providers } from '../adapters/registry';
import type { CandidateRoute, CuratedRoute } from '../domain';
import {
  CURATED_DEFAULTS,
  curatedCoverage,
  curatedDistanceTolerancePct,
  curationLabel,
  selectCuratedRoutes,
  type CuratedCoverage,
} from '../engine/curated';
import { planFailureReason } from './planStore';
import type { PlanInputs } from './plan/runPlan';
import { scoreBuiltRoutes } from './plan/scoreRoutes';
import { useResultsStore } from './resultsStore';

type Status = 'idle' | 'loading' | 'ready' | 'error';

/** Provenance shown on Results for one curated candidate. Display only — never a score input. */
export interface CuratedBadge {
  name: string;
  /** e.g. "National cycle route · signed on OpenStreetMap". */
  label: string;
  kind: 'loop' | 'linear';
  lengthKm: number;
  startDistanceM: number;
  /** The signed route is mapped in pieces; this is its longest continuous section (WR-052). */
  partial: boolean;
}

export interface CuratedDeps {
  providers?: Providers;
  now?: number;
  loadGrid?: Parameters<typeof scoreBuiltRoutes>[3]['loadGrid'];
  loadCatalog?: () => Promise<CuratedCatalog>;
  /** Navigate to Results on success (defaults to setting the location hash). */
  navigate?: () => void;
}

interface CuratedState {
  status: Status;
  /** Keyed by candidate id (always `cur-…`), so a badge can never land on an ordinary plan's card. */
  badges: Record<string, CuratedBadge>;
  /** Required credits for the sources actually on screen (ODbL, Bikeland). */
  attributions: string[];
  error: string | null;
  findNearby: (inputs: PlanInputs, deps?: CuratedDeps) => Promise<void>;
  reset: () => void;
}

/** `cur-` prefix mirrors WR-047's `disc-`: curated provenance can never leak onto a normal plan. */
export const CURATED_ID_PREFIX = 'cur-';

export function isCuratedId(id: string): boolean {
  return id.startsWith(CURATED_ID_PREFIX);
}

/** Honest, cause-naming copy (DEC-057), mirroring planFailureReason / aiFailureReason. */
export function curatedFailureReason(e: unknown): string {
  if (isProviderError(e)) {
    if (e.code === 'no-catalog') {
      return 'The curated route catalog isn’t in this build yet — run tools/fetch_curated_routes.mjs and deploy.';
    }
    if (e.code === 'stale-catalog' || e.code === 'bad-catalog') {
      return 'The curated route catalog looks corrupt — rebuild it with tools/fetch_curated_routes.mjs.';
    }
    return planFailureReason(e);
  }
  return 'Couldn’t load curated routes right now — try again.';
}

/**
 * Why nothing matched — "no curated routes" is two different problems and only one of them is the
 * rider's to fix. Nothing mapped nearby is a data-coverage fact (say it, and name how far the
 * nearest one is); routes nearby that don't fit the distance is a slider away from working.
 */
export function noMatchReason(coverage: CuratedCoverage, targetKm: number): string {
  const radiusKm = CURATED_DEFAULTS.maxStartDistanceM / 1000;
  if (!coverage.nearest) {
    return 'The curated catalog is empty — rebuild it with tools/fetch_curated_routes.mjs.';
  }
  if (coverage.withinRadius === 0) {
    const awayKm = coverage.nearest.startDistanceM / 1000;
    return `No curated route passes within ${radiusKm} km of your start. The nearest is “${coverage.nearest.route.name}”, ${awayKm.toFixed(awayKm < 10 ? 1 : 0)} km away.`;
  }
  const band = `${Math.round(targetKm * CURATED_DEFAULTS.minLengthRatio)}–${Math.round(targetKm * CURATED_DEFAULTS.maxLengthRatio)} km`;
  const fit = coverage.closestFit;
  const closest = fit ? ` The closest is “${fit.route.name}” at ${fit.route.lengthKm} km.` : '';
  return `${coverage.withinRadius} curated route${coverage.withinRadius === 1 ? '' : 's'} pass near you, but none is ${band}.${closest}`;
}

/**
 * A curated route becomes a candidate with NO elevation: the catalog stores geometry only, so the
 * speed model grades every segment flat and the ETA is a flat-profile estimate. Said plainly in the
 * UI rather than dressed up — an invented elevation profile would be worse than a stated gap.
 */
function toCandidate(route: CuratedRoute): CandidateRoute {
  return {
    id: `${CURATED_ID_PREFIX}${route.id}`,
    polyline: route.polyline,
    segments: [], // scoreBuiltRoutes resamples a bare polyline
    distanceM: route.lengthKm * 1000,
    ascentM: 0,
  };
}

export const useCuratedStore = create<CuratedState>((set) => ({
  status: 'idle',
  badges: {},
  attributions: [],
  error: null,

  findNearby: async (inputs, deps) => {
    const providers = deps?.providers ?? getProviders();
    set({ status: 'loading', error: null, badges: {}, attributions: [] });
    try {
      const catalog = await (deps?.loadCatalog ?? (() => loadCuratedCatalog()))();
      const select = { start: inputs.start, targetKm: inputs.distanceKm };
      const picks = selectCuratedRoutes(catalog.routes, select);
      if (picks.length === 0) {
        set({
          status: 'error',
          error: noMatchReason(curatedCoverage(catalog.routes, select), inputs.distanceKm),
          badges: {},
          attributions: [],
        });
        return;
      }

      const badges: Record<string, CuratedBadge> = {};
      const candidates = picks.map((pick) => {
        const candidate = toCandidate(pick.route);
        badges[candidate.id] = {
          name: pick.route.name,
          label: curationLabel(pick.route),
          kind: pick.route.kind,
          lengthKm: pick.route.lengthKm,
          startDistanceM: Math.round(pick.startDistanceM),
          partial: pick.route.partial,
        };
        return candidate;
      });

      const { ranked, rejected, shelterDataAvailable, winter } = await scoreBuiltRoutes(
        providers,
        inputs,
        candidates,
        {
          now: deps?.now ?? Date.now(),
          loadGrid: deps?.loadGrid,
          // A signed route's length is a fact, not a target the router can retry (see engine note).
          distanceTolerancePct: curatedDistanceTolerancePct(),
        },
      );
      if (ranked.length === 0) {
        set({
          status: 'error',
          error: 'None of the curated routes near you fit today’s constraints.',
          badges: {},
          attributions: [],
        });
        return;
      }

      // Credit only the sources actually on screen.
      const shown = new Set(
        ranked
          .map((r) => picks.find((p) => `${CURATED_ID_PREFIX}${p.route.id}` === r.candidate.id))
          .filter((p): p is (typeof picks)[number] => !!p)
          .map((p) => p.route.attribution),
      );
      useResultsStore.getState().setResults({ ranked, rejected, shelterDataAvailable, winter });
      set({ status: 'ready', badges, attributions: [...shown], error: null });
      (
        deps?.navigate ??
        (() => {
          if (typeof window !== 'undefined') window.location.hash = '#/results';
        })
      )();
    } catch (e) {
      set({ status: 'error', error: curatedFailureReason(e), badges: {}, attributions: [] });
    }
  },

  reset: () => set({ status: 'idle', badges: {}, attributions: [], error: null }),
}));
