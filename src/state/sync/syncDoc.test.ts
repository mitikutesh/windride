import { describe, expect, it } from 'vitest';
import type { SavedRoute } from '../../data/db';
import type { PlanInputs } from '../plan/runPlan';
import { buildSyncDoc, isSavedRoute, isSyncDoc, mergeSyncDocs, type SyncDoc } from './syncDoc';

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
});
