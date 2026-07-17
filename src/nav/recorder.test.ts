import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import cleanLoopGpx from '../../fixtures/traces/clean-loop.gpx?raw';
import cleanRouteRaw from '../../fixtures/traces/clean-loop-route.json?raw';
import { deleteRide, getRecordingRide, listRides } from '../data/db';
import type { LatLon } from '../domain';
import { polylineLengthM } from '../engine/geometry';
import { fromGpx } from '../utils/gpx';
import { parseTraceToFixes } from './replay';
import { IdbRideRecorder, loadRidePoints, saveUnfinishedRide } from './recorder';

const cleanRoute = JSON.parse(cleanRouteRaw) as LatLon[];
let rideCounter = 0;
const nextId = () => `ride-${rideCounter++}`;

describe('IdbRideRecorder', () => {
  beforeEach(async () => {
    for (const r of await listRides()) await deleteRide(r.id); // isolate the shared idb
  });

  it('records a full trace to GPX within 1% of the trace length', async () => {
    const id = nextId();
    const rec = new IdbRideRecorder({ rideId: id, name: 'Test ride', startedAt: 1e12 });
    rec.start();
    const fixes = parseTraceToFixes(cleanLoopGpx);
    for (const f of fixes) rec.addFix(f);
    const gpx = await rec.finish();

    const points = fromGpx(gpx);
    expect(points).toHaveLength(fixes.length); // every fix recorded
    let dist = 0;
    for (let i = 1; i < points.length; i++) {
      dist += Math.hypot(
        (points[i].lat - points[i - 1].lat) * 111_320,
        (points[i].lon - points[i - 1].lon) * 111_320 * Math.cos((points[i].lat * Math.PI) / 180),
      );
    }
    const trueLength = polylineLengthM(cleanRoute);
    expect(Math.abs(dist - trueLength) / trueLength).toBeLessThan(0.01);

    // Ride is finished with a summary; no recording ride remains.
    const rides = await listRides();
    const saved = rides.find((r) => r.id === id)!;
    expect(saved.status).toBe('finished');
    expect(saved.summary?.distanceM).toBeGreaterThan(0);
  });

  it('appends points in batches of 10', async () => {
    const id = nextId();
    const rec = new IdbRideRecorder({ rideId: id, name: 'Batches', startedAt: 1e12 });
    rec.start();
    for (let i = 0; i < 25; i++) {
      rec.addFix({ lat: 60 + i * 1e-4, lon: 24, time: new Date(1e12 + i * 1000).toISOString() });
    }
    await rec.flush(); // settle the write chain (20 auto-flushed, 5 buffered)
    expect(await loadRidePoints(id)).toHaveLength(25);
  });

  it('survives a simulated app kill mid-ride (crash-safe resume)', async () => {
    const id = nextId();
    const rec = new IdbRideRecorder({ rideId: id, name: 'Interrupted', startedAt: 1e12 });
    rec.start();
    for (let i = 0; i < 23; i++) {
      rec.addFix({ lat: 60 + i * 1e-4, lon: 24, time: new Date(1e12 + i * 1000).toISOString() });
    }
    await rec.flush(); // visibility-change flush before the "kill" — no finish()

    // "Reopen": the unfinished ride is offered, with all points intact.
    const recording = await getRecordingRide();
    expect(recording?.id).toBe(id);
    const points = await loadRidePoints(id);
    expect(points).toHaveLength(23);

    // Resume and finish adds more points on top of the recovered ones.
    const resumed = new IdbRideRecorder({
      rideId: id,
      name: 'Interrupted',
      startedAt: 1e12,
      resumePoints: points,
    });
    resumed.addFix({ lat: 61, lon: 24, time: new Date(1e12 + 23_000).toISOString() });
    const gpx = await resumed.finish();
    expect(fromGpx(gpx)).toHaveLength(24);
    expect(await getRecordingRide()).toBeUndefined(); // finished
  });

  it('saveUnfinishedRide finalises without resuming', async () => {
    const id = nextId();
    const rec = new IdbRideRecorder({ rideId: id, name: 'Save me', startedAt: 1e12 });
    rec.start();
    for (let i = 0; i < 12; i++) {
      rec.addFix({ lat: 60 + i * 1e-4, lon: 24, time: new Date(1e12 + i * 1000).toISOString() });
    }
    await rec.flush();
    const recording = (await getRecordingRide())!;
    const gpx = await saveUnfinishedRide(recording);
    expect(fromGpx(gpx)).toHaveLength(12);
    expect(await getRecordingRide()).toBeUndefined();
  });
});
