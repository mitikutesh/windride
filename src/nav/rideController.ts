/**
 * nav/rideController.ts — the live ride pipeline (WR-016). Feeds each GPS/replay fix through the
 * WR-013 snapper, WR-014 cue scheduler/announcer, WR-015 off-route monitor, and the WR-016 ETA and
 * heading helpers, returning a RideState snapshot the Ride screen renders. UI-agnostic and driven
 * by any FixSource, so it runs identically under live GPS and the replay dev panel, and is unit-
 * testable end to end. Pausing stops cue output and gates cue firing.
 */
import type { CandidateAnalysis } from '../engine/scoring';
import { bearingDeg, haversineM } from '../engine/geometry';
import type { CandidateRoute, LatLon } from '../domain';
import type { Announcer } from './announcer';
import {
  buildCuePoints,
  CueScheduler,
  nextManeuver,
  proximityToManeuverM,
  type UnitSystem,
} from './cues';
import type { Fix } from './fixSource';
import { EtaEstimator } from './eta';
import { blendHeading, HeadingSmoother } from './heading';
import { MapBearingGate } from './mapBearing';
import { turnKindOf, type TurnKind } from './turnKind';
import { classifyWindKind, type WindKind } from '../engine/wind';
import { detectGustStretches, type GustStretch } from '../engine/gustFlags';
import { bearingToTrack, OffRouteMonitor, type OffRouteState } from './offRoute';
import { AUTO_PAUSE_S, MOVING_SPEED_MS } from './rideSummary';
import {
  estimateProgressFromPath,
  pointAtDistance,
  prepareTrack,
  Snapper,
  type Track,
} from './snap';
import { nextWindTransition, toWindHudSegments, type WindTransition } from './windHud';

/** How far past a junction the outgoing bearing is measured — short enough to BE the road's direction. */
export const JUNCTION_EXIT_M = 25;

export interface NextTurn {
  instruction: string;
  inM: number;
  /** Which maneuver this is, for the arrow (WR-056). From the provider code, guarded by the text. */
  kind: TurnKind;
  /** A second maneuver following closely, announced in the same breath — a small "then" hint. */
  thenKind?: TurnKind;
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
  /**
   * Bearing to rotate the map to in heading-up mode (WR-053), or null before the rider has moved
   * far enough to establish one. Deliberately NOT `headingDeg`: this one is gated GPS travel only,
   * never the device compass, so the map can't spin while the rider stands still (mapBearing.ts).
   */
  mapBearingDeg: number | null;
  perpendicularM: number;
  onTrack: boolean;
  offRoute: OffRouteState;
  nextTurn: NextTurn | null;
  /**
   * Distance to the nearest maneuver the rider is steering THROUGH — not the same thing as
   * `nextTurn.inM`: it stays 0 for a short grace window after the node is passed (mid-corner), skips
   * the arrival step and "continue straight", and is null on a route with no steps. Drives the
   * junction-approach zoom (WR-055).
   */
  turnProximityM: number | null;
  /**
   * The next junction the rider steers through, and the bearing the route LEAVES it on (WR-057) —
   * for the on-map arrow. Null when no maneuver is ahead. Whether to draw it is the camera's call,
   * not this one's, so the Ride screen gates it on `turnProximityM`.
   */
  junction: { at: LatLon; outBearingDeg: number } | null;
  windTransition: WindTransition | null;
  /** Wind at the rider's current segment (HUD arrow + colour). */
  wind: CurrentWind | null;
  /** Bearing + distance back to the track while off-route (guidance arrow), else null. */
  toTrack: { bearingDeg: number; distanceM: number } | null;
  /** Modelled elapsed-time fraction 0..1 — positions the time-weighted ribbon dot. */
  timeFraction: number;
  /** Auto-pause: rider stopped (< 1.2 km/h) for > 20 s (NAVIGATION_SPEC §6). */
  autoPaused: boolean;
  /** Exposed-crosswind gust stretch within 500 m ahead (WR-021), else null. */
  gustAhead: { inM: number; maxGustMs: number } | null;
  /** Raw GPS fix — the rider's TRUE position. The map marker uses this, never `snapped`, so the
   *  rider is drawn where they actually are even when off the route (WR-051). */
  position: LatLon;
  snapped: LatLon;
  paused: boolean;
}

export interface RideControllerOptions {
  analysis: CandidateAnalysis;
  announcer: Announcer;
  unit?: UnitSystem;
  /**
   * The recorded points of a crash-interrupted ride being resumed. Seeds the snapper near the
   * rider's real progress (see estimateProgressFromPath) instead of the route start — a fresh ride
   * always seeds 0 (F-004: a closed loop must never cold-latch at the finish arm).
   */
  resumePath?: LatLon[];
}

/** What the reroute coordinator needs to ask the router for a fresh leg (WR follow-up, DEC-022). */
export interface RerouteInputs {
  current: LatLon;
  route: CandidateRoute;
  track: Track;
  progressM: number;
}

export class RideController {
  private readonly announcer: Announcer;
  private readonly unit: UnitSystem;
  // Derived from the active analysis; rebuilt by load() so a reroute can swap the whole route in.
  private analysis!: CandidateAnalysis;
  private track!: Track;
  private snapper!: Snapper;
  private scheduler!: CueScheduler;
  private hudSegs!: ReturnType<typeof toWindHudSegments>;
  private cuePoints!: ReturnType<typeof buildCuePoints>;
  private gustStretches!: GustStretch[];
  private segDistStart: number[] = [];
  private segTimeStart: number[] = [];

  private monitor = new OffRouteMonitor();
  private readonly eta = new EtaEstimator(); // speed EMA survives a reroute — the rider is unchanged
  private readonly heading = new HeadingSmoother();
  // Map rotation (WR-053) is gated on travel only — see mapBearing.ts for why the compass is
  // excluded. Survives a reroute: it describes the rider's motion, not the route.
  private readonly mapBearing = new MapBearingGate();
  // Latest device-compass heading (task #32) + last speed, so the blended display heading can be
  // recomputed on a compass event between GPS fixes (a stationary rider turning the phone).
  private compassDeg: number | null = null;
  private lastSpeedMs = 0;

  private gustAnnounced = new Set<number>();
  private pausedFlag = false;
  private lastFix: { p: LatLon; tMs: number } | null = null;
  private lastOffRoute: OffRouteState = 'on-route';
  private trailingStoppedS = 0;
  // Latest snapped progress + raw position, so the reroute coordinator can act between fixes.
  private lastProgressM = 0;
  private lastPosition: LatLon | null = null;

  constructor(opts: RideControllerOptions) {
    this.announcer = opts.announcer;
    this.unit = opts.unit ?? 'metric';
    this.load(opts.analysis, 0); // rides start at the route start (F-004)
    if (opts.resumePath?.length) {
      const seed = estimateProgressFromPath(this.track, opts.resumePath);
      this.snapper = new Snapper(this.track, seed);
      this.lastProgressM = seed;
    }
  }

  /**
   * (Re)build all route-derived state from an analysis — used by the constructor and applyReroute.
   * `seedProgressM` seeds the new snapper (the constructor passes 0 — rides start at the route
   * start; reroute passes 0 — the spliced leg's start) so it uses the windowed search from there
   * instead of a global cold-start that could mis-latch on a loop (F-004). Resume overrides the
   * seed afterwards from the recorded path.
   */
  private load(analysis: CandidateAnalysis, seedProgressM: number | null = null): void {
    this.analysis = analysis;
    this.track = prepareTrack(analysis.candidate.polyline);
    this.snapper = new Snapper(this.track, seedProgressM);
    this.cuePoints = buildCuePoints(analysis.candidate.steps ?? [], this.track);
    this.scheduler = new CueScheduler(this.cuePoints, this.unit);
    this.hudSegs = toWindHudSegments(analysis.segments);
    this.gustStretches = detectGustStretches(analysis.segments);
    this.gustAnnounced = new Set();
    this.segDistStart = [];
    this.segTimeStart = [];
    let d = 0;
    let t = 0;
    for (const sa of analysis.segments) {
      this.segDistStart.push(d);
      this.segTimeStart.push(t);
      d += sa.seg.lengthM;
      t += sa.timeS;
    }
  }

  /** The route currently being navigated (swapped on reroute). */
  get route(): CandidateRoute {
    return this.analysis.candidate;
  }

  /** Inputs for a reroute attempt, or null before the first on-track fix. */
  rerouteInputs(): RerouteInputs | null {
    if (!this.lastPosition) return null;
    return {
      current: this.lastPosition,
      route: this.analysis.candidate,
      track: this.track,
      progressM: this.lastProgressM,
    };
  }

  /**
   * Swap in a re-analysed spliced route after a successful reroute (DEC-022 wiring): reset the
   * snapper (cold-start on the new geometry), off-route monitor and cues, and announce the change.
   * The speed EMA and heading survive — the rider hasn't changed, only the line ahead.
   */
  applyReroute(analysis: CandidateAnalysis): void {
    this.load(analysis, 0); // spliced leg starts at the rider ⇒ seed progress 0, windowed acquire
    this.lastProgressM = 0; // the old-track progress no longer applies
    this.monitor = new OffRouteMonitor();
    this.lastOffRoute = 'on-route';
    this.announcer.stop(); // drop stale turn cues for the old geometry
    // A paused rider can Accept from the reroute dialog (WR-051) — the visual swap is enough;
    // voicing a cue would break the pause contract ("pausing stops cue output").
    if (!this.pausedFlag) {
      this.announcer.announce({
        stepIndex: -3,
        kind: 'turn',
        text: 'New route, follow the track',
        turnDistanceM: 0,
      });
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

  /**
   * Feed the latest device-compass heading (deg, 0..360), or null to drop the compass. Returns the
   * current blended display heading so the map arrow can rotate between GPS fixes — e.g. a stopped
   * rider turning the phone, when no new fix (and so no new RideState) is coming (task #32).
   */
  setCompassHeading(deg: number | null): number | null {
    this.compassDeg = deg;
    // Reuses the last fix's speed to weight the blend — up to ~1 fix (~1 s) stale right after a
    // stop/start, which just delays the travel↔compass handoff by one fix; onFix reconciles it.
    return blendHeading(this.heading.current, this.compassDeg, this.lastSpeedMs);
  }

  onFix(fix: Fix): RideState {
    const snap = this.snapper.update(fix);
    const position: LatLon = { lat: fix.lat, lon: fix.lon };
    this.lastProgressM = snap.progressM;
    this.lastPosition = position;
    const prevTMs = this.lastFix?.tMs;
    const measuredMs = this.speedOf(fix); // null when unknown (don't poison the EMA)
    const speedMs = measuredMs ?? 0;
    this.lastSpeedMs = speedMs;
    // Display heading = GPS travel bearing blended with the device compass by speed (task #32):
    // travel when moving, compass when stopped. This per-fix value feeds the whole RideState — map
    // arrow, wind HUD, off-route arrow (the between-fix compass refinement below reaches only the map).
    const travelDeg = this.heading.update(fix);
    const headingDeg = blendHeading(travelDeg, this.compassDeg, speedMs);
    // The MAP bearing takes the raw travel bearing, before the compass is blended in (WR-053).
    const mapBearingDeg = this.mapBearing.update(position, travelDeg);

    // Auto-pause: accumulate trailing sub-threshold time, reset on movement (NAVIGATION_SPEC §6).
    const dtS = prevTMs !== undefined ? (Date.parse(fix.time) - prevTMs) / 1000 : 0;
    if (measuredMs !== null && dtS > 0) {
      this.trailingStoppedS = measuredMs < MOVING_SPEED_MS ? this.trailingStoppedS + dtS : 0;
    }
    const autoPaused = this.trailingStoppedS > AUTO_PAUSE_S;

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
    // Audible off-route alert once per episode (NAVIGATION_SPEC §3). The Ride screen then offers a
    // confirm-first reroute (WR-051); the bearing-to-track arrow guides the rider meanwhile.
    if (offRoute === 'alert' && this.lastOffRoute !== 'alert') {
      this.announcer.announce({
        stepIndex: -1,
        kind: 'turn',
        text: 'Off route, return to the track',
        turnDistanceM: 0,
      });
    }
    this.lastOffRoute = offRoute;

    // Exposed-crosswind gust stretch within 500 m ahead OR currently inside one — warn once on
    // approach (WR-021, NAVIGATION_SPEC §4); inM ≤ 0 means the rider is in the stretch now.
    let gustAhead: RideState['gustAhead'] = null;
    for (const s of this.gustStretches) {
      const inM = s.startM - snap.progressM;
      const inside = snap.progressM >= s.startM && snap.progressM < s.endM;
      if ((inM > 0 && inM <= 500) || inside) {
        gustAhead = { inM: inside ? 0 : inM, maxGustMs: s.maxGustMs };
        if (!this.gustAnnounced.has(s.startM)) {
          this.gustAnnounced.add(s.startM);
          this.announcer.announce({
            stepIndex: -2,
            kind: 'turn',
            text: `Crosswind gusts ahead, up to ${Math.round(s.maxGustMs)} metres per second`,
            turnDistanceM: s.startM,
          });
        }
        break;
      }
    }

    return {
      progressM: snap.progressM,
      remainingM: snap.remainingM,
      speedMs,
      speedKmh: speedMs * 3.6,
      etaS,
      headingDeg,
      mapBearingDeg,
      perpendicularM: snap.perpendicularM,
      onTrack: snap.onTrack,
      offRoute,
      nextTurn: this.nextTurn(snap.progressM),
      turnProximityM: proximityToManeuverM(this.cuePoints, snap.progressM),
      junction: this.junctionAt(snap.progressM),
      windTransition: nextWindTransition(this.hudSegs, snap.progressM),
      wind: this.windAt(snap.progressM),
      toTrack:
        offRoute === 'alert' ? bearingToTrack({ lat: fix.lat, lon: fix.lon }, snap.snapped) : null,
      timeFraction,
      autoPaused,
      gustAhead,
      position,
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

  /**
   * Where the next junction is and which way the route leaves it. The outgoing bearing is a chord over
   * JUNCTION_EXIT_M — short enough that the chord IS the road's direction, and it needs no averaging
   * machinery. Clamped at the route end so a maneuver near the finish still yields a bearing.
   */
  private junctionAt(progressM: number): RideState['junction'] {
    const cue = nextManeuver(this.cuePoints, progressM);
    if (!cue) return null;
    const at = pointAtDistance(this.track, cue.turnDistanceM);
    const exitM = Math.min(cue.turnDistanceM + JUNCTION_EXIT_M, this.track.total);
    if (exitM <= cue.turnDistanceM) return null; // the maneuver sits on the last vertex
    const outBearingDeg = bearingDeg(at, pointAtDistance(this.track, exitM));
    return { at, outBearingDeg };
  }

  private nextTurn(progressM: number): NextTurn | null {
    for (const cue of this.cuePoints) {
      // A fully-suppressed cue shares its junction with the one before it (WR-056) — it is not a
      // separate thing to show on the card.
      if (cue.suppress === 'all') continue;
      if (cue.turnDistanceM > progressM) {
        return {
          instruction: cue.instruction,
          inM: cue.turnDistanceM - progressM,
          kind: turnKindOf(cue),
          thenKind: cue.thenKind,
        };
      }
    }
    return null;
  }
}
