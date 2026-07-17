/**
 * nav/recorder.ts — crash-safe ride recorder (WR-017, NAVIGATION_SPEC §6).
 *
 * Fixes stream into idb in batches of 10 (also flushed on pause / visibility change / finish) so a
 * crash loses at most a partial batch; on next launch getRecordingRide() surfaces the unfinished
 * ride for resume-or-save. Finishing writes a summary and returns GPX 1.1 via the shared writer.
 */
import type { RideSummary } from '../domain';
import type { CandidateAnalysis } from '../engine/scoring';
import {
  appendRidePoints,
  createRide,
  getRidePoints,
  updateRide,
  type RecordedRide,
  type RidePointRecord,
} from '../data/db';
import { toGpx } from '../utils/gpx';
import type { GpxPoint } from '../utils/gpx';
import type { Fix } from './fixSource';
import { summarizeRide } from './rideSummary';

export interface RideRecorder {
  start(): void;
  addFix(fix: Fix): void;
  pause(): void;
  resume(): void;
  /** Persist buffered points now (visibility change / backgrounding). */
  flush(): Promise<void>;
  /** Finish and return the recorded GPX. */
  finish(): Promise<string>;
}

/** No-op recorder — a safe default before a ride starts. */
export const nullRecorder: RideRecorder = {
  start: () => {},
  addFix: () => {},
  pause: () => {},
  resume: () => {},
  flush: () => Promise.resolve(),
  finish: () => Promise.resolve(''),
};

export const RIDE_BATCH_SIZE = 10;

export interface RecorderOptions {
  rideId: string;
  name: string;
  startedAt: number;
  routeId?: string;
  analysis?: CandidateAnalysis;
  medianHeadwindKm?: number;
  chosenHeadwindKm?: number;
  batchSize?: number;
  /** Seed points when resuming an unfinished ride. */
  resumePoints?: GpxPoint[];
}

export class IdbRideRecorder implements RideRecorder {
  private readonly opts: RecorderOptions;
  private readonly batchSize: number;
  private readonly all: GpxPoint[] = [];
  private buffer: RidePointRecord[] = [];
  private seq = 0;
  private writeChain: Promise<void> = Promise.resolve();
  /** Last persistence error, surfaced instead of silently swallowed. */
  lastError: unknown = null;

  constructor(opts: RecorderOptions) {
    this.opts = opts;
    this.batchSize = opts.batchSize ?? RIDE_BATCH_SIZE;
    if (opts.resumePoints) {
      this.all.push(...opts.resumePoints);
      this.seq = opts.resumePoints.length;
    }
  }

  start(): void {
    const ride: RecordedRide = {
      id: this.opts.rideId,
      name: this.opts.name,
      routeId: this.opts.routeId,
      startedAt: this.opts.startedAt,
      status: 'recording',
    };
    this.enqueue(() => createRide(ride));
  }

  addFix(fix: Fix): void {
    const point: GpxPoint = { lat: fix.lat, lon: fix.lon, ele: fix.ele, time: fix.time };
    this.all.push(point);
    this.buffer.push({ rideId: this.opts.rideId, seq: this.seq++, ...point });
    if (this.buffer.length >= this.batchSize) void this.flush();
  }

  pause(): void {
    void this.flush();
  }

  resume(): void {
    // no-op: recording continues; kept for the RideRecorder contract
  }

  /** Persist any buffered points now (pause / visibility change / finish). */
  flush(): Promise<void> {
    if (this.buffer.length === 0) return this.writeChain;
    const batch = this.buffer;
    this.buffer = [];
    this.enqueue(() => appendRidePoints(batch));
    return this.writeChain;
  }

  async finish(): Promise<string> {
    await this.flush();
    const summary: RideSummary = summarizeRide(this.all, {
      analysis: this.opts.analysis,
      medianHeadwindKm: this.opts.medianHeadwindKm,
      chosenHeadwindKm: this.opts.chosenHeadwindKm,
    });
    const finishedAt = this.lastPointMs() ?? this.opts.startedAt;
    this.enqueue(() => updateRide(this.opts.rideId, { status: 'finished', finishedAt, summary }));
    await this.writeChain;
    return toGpx({ name: this.opts.name, points: this.all });
  }

  private lastPointMs(): number | undefined {
    const t = this.all[this.all.length - 1]?.time;
    const ms = t ? Date.parse(t) : NaN;
    return Number.isFinite(ms) ? ms : undefined;
  }

  private enqueue(fn: () => Promise<void>): void {
    this.writeChain = this.writeChain.then(fn).catch((e) => {
      this.lastError = e; // record, don't swallow silently or leave an unhandled rejection
    });
  }
}

/** Load an unfinished ride's points as GpxPoints (for resume or save-and-discard). */
export async function loadRidePoints(rideId: string): Promise<GpxPoint[]> {
  const points = await getRidePoints(rideId);
  return points.map((p) => ({ lat: p.lat, lon: p.lon, ele: p.ele, time: p.time }));
}

/** Finalise an unfinished ride from idb without resuming it (the "save" branch of the prompt). */
export async function saveUnfinishedRide(ride: RecordedRide): Promise<string> {
  const points = await loadRidePoints(ride.id);
  const summary = summarizeRide(points);
  const finishedAt = points.length
    ? Date.parse(points[points.length - 1].time ?? '')
    : ride.startedAt;
  await updateRide(ride.id, {
    status: 'finished',
    finishedAt: Number.isFinite(finishedAt) ? finishedAt : ride.startedAt,
    summary,
  });
  return toGpx({ name: ride.name, points });
}
