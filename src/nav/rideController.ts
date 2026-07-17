/**
 * nav/rideController.ts — the live ride pipeline (WR-016). Feeds each GPS/replay fix through the
 * WR-013 snapper, WR-014 cue scheduler/announcer, WR-015 off-route monitor, and the WR-016 ETA and
 * heading helpers, returning a RideState snapshot the Ride screen renders. UI-agnostic and driven
 * by any FixSource, so it runs identically under live GPS and the replay dev panel, and is unit-
 * testable end to end. Pausing stops cue output and gates cue firing.
 */
import type { CandidateAnalysis } from '../engine/scoring';
import { haversineM } from '../engine/geometry';
import type { LatLon } from '../domain';
import type { Announcer } from './announcer';
import { buildCuePoints, CueScheduler, type UnitSystem } from './cues';
import type { Fix } from './fixSource';
import { EtaEstimator } from './eta';
import { HeadingSmoother } from './heading';
import { classifyWindKind, type WindKind } from '../engine/wind';
import { bearingToTrack, OffRouteMonitor, type OffRouteState } from './offRoute';
import { prepareTrack, Snapper, type Track } from './snap';
import { nextWindTransition, toWindHudSegments, type WindTransition } from './windHud';

export interface NextTurn {
  instruction: string;
  inM: number;
}

export interface CurrentWind {
  kind: WindKind;
  /** Direction the wind blows TO (0..360), for a HUD arrow drawn relative to heading. */
  windToDeg: number;
}

export interface RideState {
  progressM: number;
  remainingM: number;
  speedMs: number;
  speedKmh: number;
  /** Wind-aware ETA for the rest of the ride (s). */
  etaS: number;
  headingDeg: number | null;
  perpendicularM: number;
  onTrack: boolean;
  offRoute: OffRouteState;
  nextTurn: NextTurn | null;
  windTransition: WindTransition | null;
  /** Wind at the rider's current segment (HUD arrow + colour). */
  wind: CurrentWind | null;
  /** Bearing + distance back to the track while off-route (guidance arrow), else null. */
  toTrack: { bearingDeg: number; distanceM: number } | null;
  /** Modelled elapsed-time fraction 0..1 — positions the time-weighted ribbon dot. */
  timeFraction: number;
  snapped: LatLon;
  paused: boolean;
}

export interface RideControllerOptions {
  analysis: CandidateAnalysis;
  announcer: Announcer;
  unit?: UnitSystem;
}

export class RideController {
  private readonly analysis: CandidateAnalysis;
  private readonly announcer: Announcer;
  private readonly track: Track;
  private readonly snapper: Snapper;
  private readonly scheduler: CueScheduler;
  private readonly monitor = new OffRouteMonitor();
  private readonly eta = new EtaEstimator();
  private readonly heading = new HeadingSmoother();

  // Precomputed cumulative distance/time at each segment start, for modelled speed + remaining time.
  private readonly segDistStart: number[] = [];
  private readonly segTimeStart: number[] = [];
  private readonly hudSegs;
  private readonly cuePoints;

  private pausedFlag = false;
  private lastFix: { p: LatLon; tMs: number } | null = null;
  private lastOffRoute: OffRouteState = 'on-route';

  constructor(opts: RideControllerOptions) {
    this.analysis = opts.analysis;
    this.announcer = opts.announcer;
    this.track = prepareTrack(opts.analysis.candidate.polyline);
    this.snapper = new Snapper(this.track);
    this.cuePoints = buildCuePoints(opts.analysis.candidate.steps ?? [], this.track);
    this.scheduler = new CueScheduler(this.cuePoints, opts.unit ?? 'metric');
    this.hudSegs = toWindHudSegments(opts.analysis.segments);

    let d = 0;
    let t = 0;
    for (const sa of opts.analysis.segments) {
      this.segDistStart.push(d);
      this.segTimeStart.push(t);
      d += sa.seg.lengthM;
      t += sa.timeS;
    }
  }

  get paused(): boolean {
    return this.pausedFlag;
  }

  pause(): void {
    this.pausedFlag = true;
    this.announcer.stop(); // drop any queued cues so nothing fires while paused
  }

  resume(): void {
    this.pausedFlag = false;
  }

  onFix(fix: Fix): RideState {
    const snap = this.snapper.update(fix);
    const measuredMs = this.speedOf(fix); // null when unknown (don't poison the EMA)
    const speedMs = measuredMs ?? 0;
    const headingDeg = this.heading.update(fix);

    // ETA: fold actual vs modelled speed (skip while paused / when speed is unknown), then correct
    // the remaining MODELLED TIME (never distance/speed math — CLAUDE.md).
    const modelledMs = this.modelledSpeedMs(snap.progressM);
    if (!this.pausedFlag && measuredMs !== null) this.eta.update(measuredMs, modelledMs);
    const remainingModelledS = this.remainingModelledS(snap.progressM);
    const etaS = this.eta.correct(remainingModelledS);
    const total = this.analysis.totalTimeS;
    const timeFraction =
      total > 0 ? Math.max(0, Math.min(1, (total - remainingModelledS) / total)) : 0;

    // Cues — only while riding.
    if (!this.pausedFlag) {
      for (const cue of this.scheduler.update(snap.progressM, speedMs))
        this.announcer.announce(cue);
    }

    const tMs = Date.parse(fix.time);
    const { state: offRoute } = this.monitor.update(
      snap.perpendicularM,
      Number.isFinite(tMs) ? tMs : 0,
    );
    // Audible off-route alert once per episode (NAVIGATION_SPEC §3). Full auto-reroute-splice is a
    // deferred follow-up (DEC-022) — meanwhile the bearing-to-track arrow guides the rider back.
    if (offRoute === 'alert' && this.lastOffRoute !== 'alert') {
      this.announcer.announce({
        stepIndex: -1,
        kind: 'turn',
        text: 'Off route, return to the track',
        turnDistanceM: 0,
      });
    }
    this.lastOffRoute = offRoute;

    return {
      progressM: snap.progressM,
      remainingM: snap.remainingM,
      speedMs,
      speedKmh: speedMs * 3.6,
      etaS,
      headingDeg,
      perpendicularM: snap.perpendicularM,
      onTrack: snap.onTrack,
      offRoute,
      nextTurn: this.nextTurn(snap.progressM),
      windTransition: nextWindTransition(this.hudSegs, snap.progressM),
      wind: this.windAt(snap.progressM),
      toTrack:
        offRoute === 'alert' ? bearingToTrack({ lat: fix.lat, lon: fix.lon }, snap.snapped) : null,
      timeFraction,
      snapped: snap.snapped,
      paused: this.pausedFlag,
    };
  }

  private windAt(progressM: number): CurrentWind | null {
    const sa = this.analysis.segments[this.segmentIndexAt(progressM)];
    if (!sa) return null;
    return { kind: classifyWindKind(sa.wind.deltaDeg), windToDeg: sa.wind.windToDeg };
  }

  /** Fix speed if the platform gives it, else derived from the last fix; null when unknown. */
  private speedOf(fix: Fix): number | null {
    let speed = fix.speed;
    if ((speed === undefined || !Number.isFinite(speed)) && this.lastFix) {
      const dt = (Date.parse(fix.time) - this.lastFix.tMs) / 1000;
      speed = dt > 0 ? haversineM(this.lastFix.p, fix) / dt : undefined;
    }
    this.lastFix = { p: fix, tMs: Date.parse(fix.time) };
    return speed !== undefined && Number.isFinite(speed) && speed >= 0 ? speed : null;
  }

  private segmentIndexAt(progressM: number): number {
    let idx = 0;
    for (let i = 0; i < this.segDistStart.length; i++) {
      if (this.segDistStart[i] <= progressM) idx = i;
      else break;
    }
    return idx;
  }

  private modelledSpeedMs(progressM: number): number {
    const i = this.segmentIndexAt(progressM);
    return (this.analysis.segments[i]?.speedKmh ?? 0) / 3.6;
  }

  private remainingModelledS(progressM: number): number {
    const i = this.segmentIndexAt(progressM);
    const sa = this.analysis.segments[i];
    if (!sa) return 0;
    const frac = Math.max(
      0,
      Math.min(1, (progressM - this.segDistStart[i]) / (sa.seg.lengthM || 1)),
    );
    const elapsed = this.segTimeStart[i] + frac * sa.timeS;
    return Math.max(0, this.analysis.totalTimeS - elapsed);
  }

  private nextTurn(progressM: number): NextTurn | null {
    for (const cue of this.cuePoints) {
      if (cue.turnDistanceM > progressM) {
        return { instruction: cue.instruction, inM: cue.turnDistanceM - progressM };
      }
    }
    return null;
  }
}
