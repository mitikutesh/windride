import { describe, expect, it } from 'vitest';
import type { SavedRoute } from '../../data/db';
import type { PlanInputs } from '../plan/runPlan';
import {
  buildSyncDoc,
  isSavedRoute,
  isSyncDoc,
  isValidRemoteRoute,
  mergeSyncDocs,
  type SyncDoc,
} from './syncDoc';

const route = (id: string, savedAt = 1000): SavedRoute => ({
  id,
  name: `Route ${id}`,
  savedAt,
  distanceKm: 40,
  ascentM: 300,
  track: { name: `Route ${id}`, points: [] },
});

// Plan inputs that ALSO (illegally) carry key-shaped fields — to prove they never leak.
const inputs = {
  distanceKm: 55,
  routeType: 'loop',
  surface: 'gravel',
  homeBeforeDark: true,
  avoidBusy: true,
  winter: false,
  start: { lat: 60, lon: 24 },
  ors: 'SECRET-ORS-KEY',
  ai: 'SECRET-AI-KEY',
  aiProvider: 'anthropic',
} as unknown as PlanInputs;

const prefs = buildSyncDoc([], inputs).prefs;
const doc = (routes: SavedRoute[], tombstones: Record<string, string> = {}): SyncDoc => ({
  savedRoutes: routes,
  prefs,
  tombstones,
});

describe('buildSyncDoc (DEC-040 keyless guard)', () => {
  it('includes only the allow-listed prefs', () => {
    expect(buildSyncDoc([route('a')], inputs).prefs).toEqual({
      distanceKm: 55,
      routeType: 'loop',
      surface: 'gravel',
      avoidBusy: true,
      winter: false,
    });
  });

  it('field-picks routes — a contaminated route field never serialises', () => {
    const dirty = { ...route('a'), apiKey: 'LEAK', refreshToken: 'LEAK2' } as unknown as SavedRoute;
    const serialised = JSON.stringify(buildSyncDoc([dirty], inputs)).toLowerCase();
    expect(serialised).toContain('route a'); // the real route is there
    for (const forbidden of [
      'leak',
      'apikey',
      'refreshtoken',
      'secret-ors-key',
      'aiprovider',
      'digitransit',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe('mergeSyncDocs', () => {
  it('unions saved routes by id (additive) and keeps LOCAL prefs', () => {
    const merged = mergeSyncDocs(doc([route('a')]), doc([route('a'), route('b')]));
    expect(merged.savedRoutes.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(merged.prefs).toEqual(prefs);
  });

  it('a tombstone suppresses a resurrected route (delete survives the sync)', () => {
    const local = doc([], { a: '2026-07-20T10:00:00Z' }); // deleted 'a' locally
    const remote = doc([route('a', Date.parse('2026-07-20T09:00:00Z'))]); // server still has old 'a'
    const merged = mergeSyncDocs(local, remote);
    expect(merged.savedRoutes.map((r) => r.id)).not.toContain('a'); // stays deleted
    expect(merged.tombstones.a).toBe('2026-07-20T10:00:00Z');
  });

  it('a re-save newer than the delete survives the tombstone', () => {
    const local = doc([route('a', Date.parse('2026-07-20T11:00:00Z'))], {
      a: '2026-07-20T10:00:00Z',
    });
    expect(mergeSyncDocs(local, null).savedRoutes.map((r) => r.id)).toContain('a');
  });

  it('drops malformed remote route entries (no junk propagation)', () => {
    const remote = {
      savedRoutes: [{ id: 'x' }, route('b')],
      prefs,
      tombstones: {},
    } as unknown as SyncDoc;
    const merged = mergeSyncDocs(doc([]), remote);
    expect(merged.savedRoutes.map((r) => r.id)).toEqual(['b']); // '{id:x}' had no track → dropped
  });

  it('deep-rejects remote routes that would crash the app, keeping valid siblings (F-002)', () => {
    const noDistance = { ...route('nd'), distanceKm: undefined };
    const nanDistance = { ...route('nan'), distanceKm: NaN };
    const noPoints = { ...route('np'), track: {} };
    const badLat = { ...route('bl'), track: { points: [{ lat: 91, lon: 24 }] } };
    const remote = {
      savedRoutes: [noDistance, nanDistance, noPoints, badLat, route('ok')],
      prefs,
      tombstones: {},
    } as unknown as SyncDoc;
    expect(mergeSyncDocs(doc([]), remote).savedRoutes.map((r) => r.id)).toEqual(['ok']);
  });

  it('a LOCAL route with a junk point still syncs — the deep guard is remote-only', () => {
    // Regression guard: deep-filtering local routes would make defaultApply DELETE them (the
    // merged doc set-difference). Local entries must stay on the shallow guard.
    const legacy = {
      ...route('legacy'),
      track: { points: [{ lat: NaN, lon: 24 }] },
    } as unknown as SavedRoute;
    expect(mergeSyncDocs(doc([legacy]), null).savedRoutes.map((r) => r.id)).toEqual(['legacy']);
  });

  it('strips junk fields inside a pulled track (allow-list copy)', () => {
    const dirtyTrack = {
      ...route('a'),
      track: { name: 'n', points: [{ lat: 60, lon: 24, evil: 'LEAK' }], injected: 'LEAK' },
    } as unknown as SavedRoute;
    const merged = mergeSyncDocs(doc([]), doc([dirtyTrack]));
    expect(JSON.stringify(merged)).not.toContain('LEAK');
    expect(merged.savedRoutes[0].track.points[0]).toEqual({ lat: 60, lon: 24 });
  });

  it('ignores unparseable tombstones instead of suppressing the route forever', () => {
    // savedAt > Date.parse('garbage') is NaN-false, so without the guard the route would be
    // deleted on every device and the junk tombstone re-uploaded (F-108).
    const remote = doc([route('a')], { a: 'not-a-date' });
    const merged = mergeSyncDocs(doc([]), remote);
    expect(merged.savedRoutes.map((r) => r.id)).toEqual(['a']);
    expect(merged.tombstones).toEqual({});
  });
});

describe('guards', () => {
  it('isSavedRoute rejects incomplete entries', () => {
    expect(isSavedRoute(route('a'))).toBe(true);
    expect(isSavedRoute({ id: 'x' })).toBe(false);
    expect(isSavedRoute(null)).toBe(false);
  });
  it('isSyncDoc accepts a doc and rejects junk', () => {
    expect(isSyncDoc({ savedRoutes: [], prefs: {} })).toBe(true);
    expect(isSyncDoc({ savedRoutes: 'no' })).toBe(false);
  });
  it('isValidRemoteRoute validates every consumed field', () => {
    expect(isValidRemoteRoute(route('a'))).toBe(true); // empty points array is valid
    expect(isValidRemoteRoute({ ...route('a'), ascentM: Infinity })).toBe(false);
    expect(isValidRemoteRoute({ ...route('a'), savedAt: NaN })).toBe(false);
    const pts = (n: number) => Array.from({ length: n }, () => ({ lat: 60, lon: 24 }));
    expect(isValidRemoteRoute({ ...route('a'), track: { points: pts(3) } })).toBe(true);
    expect(isValidRemoteRoute({ ...route('a'), track: { points: pts(50_001) } })).toBe(false);
    expect(isValidRemoteRoute({ ...route('a'), track: { points: [{ lat: 60, lon: -181 }] } })).toBe(
      false,
    );
    expect(
      isValidRemoteRoute({ ...route('a'), track: { points: [{ lat: 60, lon: 24, ele: NaN }] } }),
    ).toBe(false);
  });
});
