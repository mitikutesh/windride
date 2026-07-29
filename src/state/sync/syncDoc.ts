// state/sync/syncDoc.ts — the sync document + pure merge (WR-041). CRITICAL (DEC-040/041): the doc
// is built from a fixed allow-list of NON-SECRET data (field-picked saved routes + a few plan
// prefs). API keys / credentials are never referenced here, so they structurally cannot be synced;
// a test guards this at both the prefs and per-route level. Deletes are tombstoned so a removal
// survives a cross-device sync instead of a pulled copy resurrecting the route.
import type { SavedRoute } from '../../data/db';
import type { GpxPoint, GpxTrack } from '../../utils/gpx';
import type { PlanInputs } from '../plan/runPlan';

/** Far above any plannable route (a 200 km ORS polyline is ~10-20k points); cheap DoS insurance. */
const MAX_SYNC_TRACK_POINTS = 50_000;

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
    track: pickTrack(r.track),
  };
}

/** Allow-list copy of a track — junk fields inside a pulled track must not persist or re-upload. */
function pickTrack(t: GpxTrack): GpxTrack {
  const track: GpxTrack = {
    points: (Array.isArray(t.points) ? t.points : []).map((p) => {
      const point: GpxPoint = { lat: p.lat, lon: p.lon };
      if (p.ele !== undefined) point.ele = p.ele;
      if (p.time !== undefined) point.time = p.time;
      return point;
    }),
  };
  if (typeof t.name === 'string') track.name = t.name;
  if (typeof t.creator === 'string') track.creator = t.creator;
  if (typeof t.time === 'string') track.time = t.time;
  return track;
}

/**
 * Shallow shape guard — the LOCAL-side filter. Local routes deliberately stay on this weaker check:
 * defaultApply deletes any local route missing from the merged doc, so deep-filtering local entries
 * would turn one bad point in a legacy route into silent local data loss. Remote entries go through
 * isValidRemoteRoute instead.
 */
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

function isValidPoint(v: unknown): v is GpxPoint {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as GpxPoint;
  return (
    Number.isFinite(p.lat) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    Number.isFinite(p.lon) &&
    p.lon >= -180 &&
    p.lon <= 180 &&
    (p.ele === undefined || Number.isFinite(p.ele)) &&
    (p.time === undefined || typeof p.time === 'string')
  );
}

/**
 * Deep guard for a route pulled from the server (F-002): every field the app renders or exports is
 * validated before the route may persist locally — a malformed pulled route must never white-screen
 * Plan (`distanceKm.toFixed`) or break GPX export (`track.points`). An empty points array is valid
 * (saved routes are only listed/exported today; a future ride-from-saved-route feature must
 * re-validate — prepareTrack needs ≥ 2 points).
 */
export function isValidRemoteRoute(v: unknown): v is SavedRoute {
  if (!isSavedRoute(v)) return false;
  return (
    Number.isFinite(v.savedAt) &&
    Number.isFinite(v.distanceKm) &&
    Number.isFinite(v.ascentM) &&
    Array.isArray(v.track.points) &&
    v.track.points.length <= MAX_SYNC_TRACK_POINTS &&
    v.track.points.every(isValidPoint)
  );
}

/** A tombstone must be a parseable date string — junk must not suppress (i.e. delete) a route. */
function isValidTombstone(at: unknown): at is string {
  return typeof at === 'string' && Number.isFinite(Date.parse(at));
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
 * (newest deletedAt per id); unparseable tombstones are skipped, since suppression compares against
 * Date.parse and NaN would delete the route forever. Prefs stay LOCAL (per-field prefs LWW is
 * deferred — DEC-052). Malformed remote entries are discarded via the DEEP guard (F-002) — local
 * entries keep the shallow one (see isSavedRoute). Offline-first: local is authoritative.
 */
export function mergeSyncDocs(local: SyncDoc, remote: SyncDoc | null): SyncDoc {
  const tombstones: Record<string, string> = {};
  for (const [id, at] of Object.entries(remote?.tombstones ?? {})) {
    if (isValidTombstone(at)) tombstones[id] = at;
  }
  for (const [id, at] of Object.entries(local.tombstones ?? {})) {
    if (!isValidTombstone(at)) continue;
    if (!tombstones[id] || tombstones[id] < at) tombstones[id] = at; // ISO compares chronologically
  }

  const byId = new Map<string, SavedRoute>();
  for (const r of (remote?.savedRoutes ?? []).filter(isValidRemoteRoute))
    byId.set(r.id, pickRoute(r));
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
