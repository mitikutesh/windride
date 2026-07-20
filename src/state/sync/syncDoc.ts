// state/sync/syncDoc.ts — the sync document + pure merge (WR-041). CRITICAL (DEC-040/041): the doc
// is built from a fixed allow-list of NON-SECRET data (field-picked saved routes + a few plan
// prefs). API keys / credentials are never referenced here, so they structurally cannot be synced;
// a test guards this at both the prefs and per-route level. Deletes are tombstoned so a removal
// survives a cross-device sync instead of a pulled copy resurrecting the route.
import type { SavedRoute } from '../../data/db';
import type { PlanInputs } from '../plan/runPlan';

export interface SyncPrefs {
  distanceKm: number;
  routeType: PlanInputs['routeType'];
  surface: PlanInputs['surface'];
  avoidBusy: boolean;
  winter: boolean;
}

export interface SyncDoc {
  savedRoutes: SavedRoute[];
  prefs: SyncPrefs;
  /** Route id → ISO deletedAt. A tombstone suppresses a route unless a newer save supersedes it. */
  tombstones: Record<string, string>;
}

/** Copy only the known SavedRoute fields — never pass an arbitrary object through to the server. */
function pickRoute(r: SavedRoute): SavedRoute {
  return {
    id: r.id,
    name: r.name,
    savedAt: r.savedAt,
    distanceKm: r.distanceKm,
    ascentM: r.ascentM,
    track: r.track,
  };
}

/** Guard a route pulled from the server before it's trusted/applied. */
export function isSavedRoute(v: unknown): v is SavedRoute {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as SavedRoute;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.savedAt === 'number' &&
    typeof r.track === 'object' &&
    r.track !== null
  );
}

/** Assemble the sync doc from non-secret local data only — an explicit allow-list, never the keychain. */
export function buildSyncDoc(
  savedRoutes: SavedRoute[],
  inputs: PlanInputs,
  tombstones: Record<string, string> = {},
): SyncDoc {
  return {
    savedRoutes: savedRoutes.filter(isSavedRoute).map(pickRoute),
    prefs: {
      distanceKm: inputs.distanceKm,
      routeType: inputs.routeType,
      surface: inputs.surface,
      avoidBusy: inputs.avoidBusy,
      winter: !!inputs.winter,
    },
    tombstones,
  };
}

/**
 * Merge local + remote docs. Routes are UNIONED by id (local wins on clash), then any route with a
 * tombstone newer than its own savedAt is dropped — so a delete on one device propagates and a
 * pulled copy can't resurrect it, while a genuine re-save (newer savedAt) survives. Tombstones union
 * (newest deletedAt per id). Prefs stay LOCAL (per-field prefs LWW is deferred — DEC-052). Malformed
 * remote entries are discarded (no junk propagation). Offline-first: local is authoritative.
 */
export function mergeSyncDocs(local: SyncDoc, remote: SyncDoc | null): SyncDoc {
  const tombstones: Record<string, string> = { ...(remote?.tombstones ?? {}) };
  for (const [id, at] of Object.entries(local.tombstones ?? {})) {
    if (!tombstones[id] || tombstones[id] < at) tombstones[id] = at; // ISO compares chronologically
  }

  const byId = new Map<string, SavedRoute>();
  for (const r of (remote?.savedRoutes ?? []).filter(isSavedRoute)) byId.set(r.id, pickRoute(r));
  for (const r of (local.savedRoutes ?? []).filter(isSavedRoute)) byId.set(r.id, pickRoute(r));

  const savedRoutes = [...byId.values()].filter((r) => {
    const t = tombstones[r.id];
    return !t || r.savedAt > Date.parse(t); // re-saved after the delete ⇒ keep; otherwise suppressed
  });

  return { savedRoutes, prefs: local.prefs, tombstones };
}

/** Defensive validation of a doc pulled from the server before it's applied locally. */
export function isSyncDoc(v: unknown): v is SyncDoc {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as SyncDoc;
  return Array.isArray(d.savedRoutes) && typeof d.prefs === 'object' && d.prefs !== null;
}
