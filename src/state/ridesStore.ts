// state/ridesStore.ts — recorded ride history + Strava upload (WR-017, WR-023).
import { create } from 'zustand';
import { isProviderError, ProviderError } from '../adapters/errors';
import { StravaUploader } from '../adapters/strava/upload';
import { deleteRide, getStravaCreds, listRides, updateRide, type RecordedRide } from '../data/db';
import { loadRidePoints } from '../nav/recorder';
import { toGpx } from '../utils/gpx';

export type StravaStatus = 'idle' | 'pending' | 'done' | 'duplicate' | 'error' | 'no-creds';

/** Injectable sender so tests don't touch the network (default builds a real StravaUploader). */
export type StravaSend = (gpx: string, name: string, externalId: string) => Promise<number>;

interface RidesState {
  rides: RecordedRide[];
  error: string | null;
  strava: Record<string, StravaStatus>;
  /** Human reason for the last Strava failure per ride — so the UI shows *why*, not just "failed". */
  stravaError: Record<string, string>;
  refresh: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  sendToStrava: (id: string, send?: StravaSend) => Promise<void>;
}

/**
 * A short, actionable reason for a Strava failure. Distinguishes the two calls that fail differently:
 * a token-refresh auth error means the client id/secret/refresh token are wrong; an upload auth error
 * means the token lacks the `activity:write` scope. Network/rate are phoned through plainly.
 */
function stravaFailureReason(e: unknown): string {
  if (isProviderError(e)) {
    if (e.kind === 'quota' || e.code === 'rate') return 'Rate-limited — retry later';
    if (e.kind === 'network') return 'Network error — retry';
    return `${e.message} — retry`; // auth / upload / timeout carry a specific message
  }
  return 'Strava failed — retry';
}

async function defaultSend(gpx: string, name: string, externalId: string): Promise<number> {
  const creds = await getStravaCreds();
  if (!creds) throw new ProviderError('badResponse', 'Strava not configured', 'no-creds');
  const uploader = new StravaUploader(creds);
  return (await uploader.sendGpx(gpx, name, externalId)).activityId;
}

export const useRidesStore = create<RidesState>((set, get) => ({
  rides: [],
  error: null,
  strava: {},
  stravaError: {},
  refresh: async () => {
    try {
      set({ rides: (await listRides()).filter((r) => r.status === 'finished'), error: null });
    } catch {
      set({ error: 'Could not load ride history' });
    }
  },
  remove: async (id) => {
    await deleteRide(id);
    await get().refresh();
  },
  sendToStrava: async (id, send = defaultSend) => {
    const ride = get().rides.find((r) => r.id === id);
    if (!ride || ride.stravaActivityId) return; // idempotent: already on Strava
    if (!(await getStravaCreds())) {
      set((s) => ({ strava: { ...s.strava, [id]: 'no-creds' } }));
      return;
    }
    set((s) => ({
      strava: { ...s.strava, [id]: 'pending' },
      stravaError: { ...s.stravaError, [id]: '' }, // clear any prior reason on retry
    }));
    try {
      const points = await loadRidePoints(id);
      const gpx = toGpx({ name: ride.name, points });
      const activityId = await send(gpx, ride.name, id);
      await updateRide(id, { stravaActivityId: activityId });
      set((s) => ({ strava: { ...s.strava, [id]: 'done' } }));
      await get().refresh();
    } catch (e) {
      const dup = isProviderError(e) && e.code === 'duplicate';
      if (!dup) console.warn('[Strava] upload failed', e); // full error for DevTools
      set((s) => ({
        strava: { ...s.strava, [id]: dup ? 'duplicate' : 'error' },
        stravaError: dup ? s.stravaError : { ...s.stravaError, [id]: stravaFailureReason(e) },
      }));
    }
  },
}));
