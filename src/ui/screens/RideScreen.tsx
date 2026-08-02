import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteRide, getRecordingRide, type RecordedRide } from '../../data/db';
import { armAudio, type Announcer, type CueMode } from '../../nav/announcer';
import type { Fix } from '../../nav/fixSource';
import { GeolocationSource } from '../../nav/locationService';
import { CompassHeadingSource } from '../../nav/compass';
import {
  IdbRideRecorder,
  loadRidePoints,
  nullRecorder,
  saveUnfinishedRide,
  type RideRecorder,
} from '../../nav/recorder';
import type { Rerouter } from '../../nav/offRoute';
import { proposeReroute, type RerouteProposal } from '../../nav/reroute';
import { RideController, type RideState } from '../../nav/rideController';
import type { TurnKind } from '../../nav/turnKind';
import type { CandidateAnalysis } from '../../engine/scoring';
import { activeSpeedSettings, useCalibrationStore } from '../../state/calibrationStore';
import { useNoveltyStore } from '../../state/noveltyStore';
import { makeRerouter } from '../../state/rerouter';
import { useResultsStore } from '../../state/resultsStore';
import { useRideSettingsStore } from '../../state/rideSettingsStore';
import { useRidesStore } from '../../state/ridesStore';
import { gpxFilename } from '../../utils/gpx';
import { formatDurationHM, localYMD, metresToKm } from '../../utils/units';
import { PrimaryButton, Segmented, StatCell, WindRibbon } from '../components';
import { RideHistory } from '../components/RideHistory';
import { RideMap } from '../components/RideMap';
import { WindHud } from '../components/WindHud';
import { WinterCaution } from '../components/WinterCaution';
import { downloadText } from '../download';
import { cruiseZoomM, turnApproachZoomM, ZOOM_APPROACH_M } from '../mapCamera';
import { routeToRibbon } from '../routeGeo';
import { useWakeLock } from '../useWakeLock';

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Turn distances read like a bike computer: metres under 1 km, km above (UI-edge conversion). */
const formatTurnDist = (inM: number): string =>
  inM < 1000 ? `${Math.max(0, Math.round(inM / 10) * 10)} m` : `${metresToKm(inM, 1)} km`;

/** Wall-clock arrival from the speed-model ETA (etaS comes from the model, never distance/speed).
 *  Forced 24-hour h:mm — the UI units convention, and "03:24 PM" overflows the glance cell. */
const arrivalClock = (etaS: number): string =>
  new Date(Date.now() + etaS * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

/**
 * How far off straight each maneuver kind points the arrow, in degrees (WR-056). Negative is left;
 * SVG rotates clockwise. One arrow rotated per kind is systematically distinct — the old glyph
 * substring-matched the instruction, so "Turn left", "Keep left" and "Sharp left" shared one arrow
 * and a roundabout (whose sentence contains no direction word at all) drew as straight ahead.
 */
const TURN_ANGLE: Partial<Record<TurnKind, number>> = {
  straight: 0,
  'slight-left': -25,
  'slight-right': 25,
  left: -65,
  right: 65,
  'sharp-left': -115,
  'sharp-right': 115,
};

const glyphStroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Big saddle-readable arrow for the next-turn card, drawn from the maneuver KIND. */
function TurnGlyph({ kind, size = 26 }: { kind: TurnKind; size?: number }) {
  // The pivot sits low so even a 115° kick stays inside the viewBox.
  const arrow = (
    <>
      <path d="M12 18 V8" {...glyphStroke} />
      <path d="M7 13 L12 8 L17 13" {...glyphStroke} />
    </>
  );
  let body: JSX.Element;
  if (kind === 'uturn') {
    body = (
      <>
        <path d="M8 19 V11 a4 4 0 0 1 8 0 v7" {...glyphStroke} />
        <path d="M13 14 L16 18 L19 14" {...glyphStroke} />
      </>
    );
  } else if (kind === 'roundabout') {
    body = (
      <>
        <circle cx="11" cy="14" r="5" {...glyphStroke} />
        <path d="M11 22 V19" {...glyphStroke} />
        <path d="M16 11 L20 5" {...glyphStroke} />
        <path d="M16 5 L20 5 L20 9" {...glyphStroke} />
      </>
    );
  } else if (kind === 'keep-left' || kind === 'keep-right') {
    const taken = kind === 'keep-left' ? 'M12 15 L7 7' : 'M12 15 L17 7';
    const other = kind === 'keep-left' ? 'M12 15 L17 8' : 'M12 15 L7 8';
    const head = kind === 'keep-left' ? 'M6 12 L7 7 L12 8' : 'M18 12 L17 7 L12 8';
    body = (
      <>
        <path d="M12 21 V15" {...glyphStroke} />
        <path d={other} {...glyphStroke} opacity={0.35} />
        <path d={taken} {...glyphStroke} />
        <path d={head} {...glyphStroke} />
      </>
    );
  } else if (kind === 'arrive') {
    body = (
      <>
        <circle cx="12" cy="12" r="7" {...glyphStroke} />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
      </>
    );
  } else {
    body = <g transform={`rotate(${TURN_ANGLE[kind] ?? 0} 12 18)`}>{arrow}</g>;
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" data-turn-kind={kind}>
      {body}
    </svg>
  );
}

/**
 * Device-orientation events fire at sensor rate (~60 Hz on Android). Pushing every one into React
 * state re-renders — and re-ran the follow camera — dozens of times per second, so the map heading
 * is published at ~8 Hz instead. The controller still sees every reading (its blend stays exact).
 */
const MAP_HEADING_MIN_INTERVAL_MS = 125;

/**
 * Live-ride map chrome in CSS px, so the follow camera never parks the rider underneath it. Mirrors
 * components.css: the next-turn card above; `--ride-panel-clear` (200px) plus the floating button
 * row below, or the details panel's `max-height: 78dvh` while it is open. Keep in sync with that file.
 */
const RIDE_INSET_TOP = 120;
const RIDE_INSET_BOTTOM = 208;
const DETAILS_SHEET_FRACTION = 0.78;

/** Fixes to leave the junction zoom alone after an accepted reroute — see acceptReroute. */
const REROUTE_SETTLE_FIXES = 3;

const DevReplayPanel = lazy(() => import('../components/DevReplayPanel'));

type RideStatus = 'idle' | 'riding' | 'paused' | 'ended';

/**
 * Confirm-first reroute (WR-051): 'offer' asks "reroute?", 'loading' fetches the leg, 'preview'
 * shows the proposed route (dashed on the map) awaiting Accept, 'error' offers a manual retry.
 * Every ORS call is behind an explicit rider tap — no automatic traffic while lost.
 */
type ReroutePhase = 'idle' | 'offer' | 'loading' | 'preview' | 'error';

/**
 * Ride screen (WR-016): the saddle UI — wind-coloured map, next-turn card, wind HUD, and a glance
 * zone of huge honest numbers. Wires the FixSource (live GPS or the replay dev panel) through the
 * RideController, holds a wake lock while riding, and offers a battery-saver mode.
 */
export function RideScreen() {
  const ranked = useResultsStore((s) => s.ranked);
  const scored = useResultsStore((s) => s.ranked.find((r) => r.candidate.id === s.selectedId));
  const winter = useResultsStore((s) => s.winter);
  const refreshRides = useRidesStore((s) => s.refresh);

  const [status, setStatus] = useState<RideStatus>('idle');
  const [rideState, setRideState] = useState<RideState | null>(null);
  const [cueMode, setCueMode] = useState<CueMode>('voice');
  const [batterySaver, setBatterySaver] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [recError, setRecError] = useState(false);
  const [unfinished, setUnfinished] = useState<RecordedRide | null>(null);

  const controllerRef = useRef<RideController | null>(null);
  const recorderRef = useRef<RideRecorder>(nullRecorder);
  const sourceRef = useRef<GeolocationSource | null>(null);
  const compassRef = useRef<CompassHeadingSource | null>(null);
  // The live announcer, kept so the on-map sound button can mute/unmute cues mid-ride.
  const announcerRef = useRef<Announcer | null>(null);
  const [muted, setMuted] = useState(false);
  // Freshest blended heading for the map arrow (task #32) — refreshed per fix and, between fixes,
  // by compass events so the arrow swings when a stopped rider turns the phone.
  const [mapHeading, setMapHeading] = useState<number | null>(null);
  /** When the compass last published to React state — see MAP_HEADING_MIN_INTERVAL_MS. */
  const lastHeadingPushRef = useRef(0);
  // Confirmed reroute (WR-051): a Rerouter, the ORIGINAL plan analysis (for reference wind), and an
  // in-flight guard. The rider drives every step — offer → confirm → preview → accept.
  const rerouterRef = useRef<Rerouter | null>(null);
  const refAnalysisRef = useRef<CandidateAnalysis | null>(null);
  const reroutingRef = useRef(false);
  const [reroutePhase, setReroutePhase] = useState<ReroutePhase>('idle');
  const [rerouteProposal, setRerouteProposal] = useState<RerouteProposal | null>(null);
  const [rerouteError, setRerouteError] = useState<{ message: string; retryable: boolean } | null>(
    null,
  );
  // "No thanks" silences the offer for the CURRENT off-route episode only; returning to the route
  // re-arms it, so wandering off again asks again.
  const rerouteDeclinedRef = useRef(false);
  // The route being navigated right now: the plan's analysis until a reroute is accepted, then the
  // live spliced analysis. The map, ribbon and preview all render THIS — an accepted reroute must be
  // visible, not just swapped inside the controller.
  const [liveAnalysis, setLiveAnalysis] = useState<CandidateAnalysis | null>(null);

  useWakeLock(status === 'riding');

  // On open, offer any crash-interrupted ride for save/discard (resume-or-save prompt).
  useEffect(() => {
    getRecordingRide()
      .then((r) => setUnfinished(r ?? null))
      .catch(() => setUnfinished(null)); // idb unavailable — no prompt, no crash
  }, []);

  // Flush buffered fixes when the tab is backgrounded — the crash-safety net for an OS app kill.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void recorderRef.current.flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  // Leaving the ride mid-stream must stop GPS + cues (else watchPosition and the announcer keep
  // running on a dead screen — battery drain and stray voice cues on other screens).
  useEffect(
    () => () => {
      sourceRef.current?.stop();
      compassRef.current?.stop();
      compassRef.current = null; // avoid a late permission resolve re-arming after unmount
      controllerRef.current?.pause();
      void recorderRef.current.flush();
    },
    [],
  );

  // What the map/ribbon render: the plan until a reroute is accepted, then the live spliced route.
  const liveScored = useMemo(
    () =>
      liveAnalysis
        ? { candidate: liveAnalysis.candidate, analysis: liveAnalysis }
        : (scored ?? null),
    [liveAnalysis, scored],
  );

  const ribbon = useMemo(() => (liveScored ? routeToRibbon(liveScored) : []), [liveScored]);
  // The ribbon is laid out by TIME share, so the dot must use the modelled time fraction, not
  // distance — otherwise it sits in the wrong wind band on headwind/tailwind routes.
  const dotFraction = rideState?.timeFraction ?? 0;

  const [manualZoomM, setManualZoomM] = useState<number | null>(null);

  // Follow-the-rider camera vs free-look. The map flips this to false when the rider drags/pinches
  // to look around; the Recenter control puts it back. Reset to true whenever a ride (re)starts.
  const [following, setFollowing] = useState(true);

  // While riding the map goes full-screen with a minimal HUD; the rest of the numbers live behind
  // a Details toggle so the map dominates (the thing you actually look at on the bike).
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Map orientation (WR-053). Heading-up rotates the map so up = travel direction, which is what
  // makes a spoken "turn left" match the screen. Held in a persisted store — set once, on the bike.
  const mapOrientation = useRideSettingsStore((s) => s.mapOrientation);
  const toggleMapOrientation = useRideSettingsStore((s) => s.toggleMapOrientation);
  // A reroute preview is an inspection view: on a rotated, rider-biased map a dashed proposal that
  // rejoins beside or behind the rider can sit off-screen entirely, so hold north-up until it is
  // accepted or dismissed.
  const headingUp = mapOrientation === 'heading-up' && reroutePhase !== 'preview';
  const mapBearingDeg = rideState?.mapBearingDeg ?? null;
  // What the compass needle on the toggle shows: north's angle on screen. Mirrors the camera's rule
  // that heading-up only takes effect once a bearing exists.
  const rotating = headingUp && mapBearingDeg !== null;
  const appliedBearingDeg = rotating ? mapBearingDeg : 0;
  // Spoken to a screen reader, for which a rotating canvas conveys nothing. Says what the map is
  // ACTUALLY doing, not what the setting says: heading-up waits for the first travel bearing.
  const orientationLabel = !headingUp
    ? 'Map is north-up'
    : rotating
      ? 'Map follows your heading'
      : 'Map follows your heading once you are moving';

  // One stable rider object per fix (and per throttled compass push). A fresh literal every render
  // would re-run RideMap's marker AND camera effects on every unrelated state change.
  const riderHeadingDeg = mapHeading ?? rideState?.headingDeg ?? null;
  const rider = useMemo(
    () =>
      rideState
        ? {
            // The RAW fix, never the snapped point — off the route the marker must show where the
            // rider actually is, not cling to the track (WR-051).
            position: rideState.position,
            headingDeg: riderHeadingDeg,
            // The CAMERA follows the snapped point while on-track: at junction zoom 1 m is ~2.8 px,
            // so following the raw fix slides the basemap ~14 px a second under a stationary chevron
            // on ordinary standing wander. Off-track, where the rider truly is matters more.
            anchor: rideState.onTrack ? rideState.snapped : rideState.position,
          }
        : null,
    [rideState, riderHeadingDeg],
  );

  const viewportH = typeof window === 'undefined' ? 0 : window.innerHeight;
  const insets = useMemo(() => {
    if (status !== 'riding' && status !== 'paused') return { top: 0, bottom: 0 };
    return {
      top: RIDE_INSET_TOP,
      bottom: detailsOpen ? Math.round(viewportH * DETAILS_SHEET_FRACTION) : RIDE_INSET_BOTTOM,
    };
  }, [status, detailsOpen, viewportH]);

  /**
   * Consecutive fixes the snapper refused (`!onTrack`), and a countdown of fixes to sit out after an
   * accepted reroute. Both are refs written in handleFix and read during the render that the same fix
   * triggers, so they are always consistent with `rideState`.
   */
  const offTrackStreakRef = useRef(0);
  const rerouteSettleRef = useRef(0);

  // Map zoom in metres across the view (WR-055). Cruise holds a constant ~30 s of road ahead;
  // approaching a maneuver tightens further. Both are pure policy in ui/mapCamera.ts.
  const cruiseM = cruiseZoomM(rideState?.speedKmh ?? 0);
  // The junction override is suppressed wherever tightening would hurt more than help:
  //  - detailsOpen: the sheet leaves a sliver of map, and at 140 m across the junction lands behind
  //    the turn card;
  //  - sustained off-route, OR two consecutive fixes the snapper refused: progress freezes the moment
  //    a fix is rejected, so turnProximityM sticks near the last node and would pin maximum zoom at
  //    the "where am I" moment. 'alert' alone is too late (it needs 10 s); one fix alone flickers;
  //  - a reroute preview (an inspection view, already held north-up) and the first few fixes after
  //    accepting one, since applyReroute restarts progress at 0 with its first step metres away;
  //  - before a map bearing exists — the rider has not moved yet, and the very first camera frame
  //    would otherwise jump straight from the whole-route fit into a 140 m box.
  const junctionZoomAllowed =
    !detailsOpen &&
    (rideState?.offRoute ?? 'on-route') !== 'alert' &&
    offTrackStreakRef.current < 2 &&
    reroutePhase !== 'preview' &&
    rerouteSettleRef.current === 0 &&
    mapBearingDeg !== null;
  const zoomM =
    manualZoomM ??
    (junctionZoomAllowed ? turnApproachZoomM(rideState?.turnProximityM ?? null, cruiseM) : cruiseM);
  // Both handlers step from what is ON SCREEN, not from cruise: mid-approach the view can be 140 m
  // across while cruise is much wider, and seeding from cruise would make "+" zoom OUT.
  const zoomIn = () => setManualZoomM(Math.max(120, Math.round(zoomM / 1.6)));
  const zoomOut = () => setManualZoomM(Math.min(4000, Math.round(zoomM * 1.6)));

  // The on-map junction arrow (WR-057) rides along with the approach: it appears once the junction is
  // near enough to matter, and stays out of the reroute-preview inspection view.
  const proximityM = rideState?.turnProximityM ?? null;
  const junctionArrow =
    proximityM !== null && proximityM <= ZOOM_APPROACH_M && reroutePhase !== 'preview'
      ? (rideState?.junction ?? null)
      : null;

  // Latest off-route state as a ref, so async reroute callbacks can check it without a stale closure.
  const offRouteRef = useRef<RideState['offRoute']>('on-route');

  const handleFix = useCallback((fix: Fix) => {
    const controller = controllerRef.current;
    if (!controller) return;
    recorderRef.current.addFix(fix);
    if (recorderRef.current.lastError) setRecError(true); // recording stopped persisting
    const state = controller.onFix(fix);
    offRouteRef.current = state.offRoute;
    // Junction-zoom guards (WR-055): count refused fixes, and burn down the post-reroute settle.
    offTrackStreakRef.current = state.onTrack ? 0 : offTrackStreakRef.current + 1;
    if (rerouteSettleRef.current > 0) rerouteSettleRef.current -= 1;
    setRideState(state);
    setMapHeading(state.headingDeg); // per-fix blended heading; compass events refine it between fixes
  }, []);

  // Reroute offer follows the off-route state (WR-051): a sustained off-route opens the "Reroute?"
  // offer (unless declined this episode); getting back ON the route ends the episode — any offer,
  // loading result, or un-accepted preview is stale the moment the rider rejoins, so drop it all.
  const offRoute = rideState?.offRoute ?? 'on-route';
  useEffect(() => {
    if (offRoute === 'alert') {
      if (!rerouteDeclinedRef.current) setReroutePhase((p) => (p === 'idle' ? 'offer' : p));
    } else if (offRoute === 'on-route') {
      rerouteDeclinedRef.current = false;
      setReroutePhase('idle');
      setRerouteProposal(null);
      setRerouteError(null);
    }
  }, [offRoute]);

  // Rider confirmed "Reroute": ONE router call for a leg back to the original route (~500 m
  // downstream — everything after the rejoin point is preserved). The result is only a proposal;
  // nothing is applied until Accept.
  const confirmReroute = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller || !rerouterRef.current || !refAnalysisRef.current || reroutingRef.current)
      return;
    reroutingRef.current = true;
    setReroutePhase('loading');
    setRerouteError(null);
    // The result is stale — show nothing — if by the time it resolves the rider has rejoined the
    // route, ended the ride, or started a new one (fresh controller). offRouteRef is reset to
    // 'on-route' by end/start/resume, so one guard covers all three.
    const isStale = () => controllerRef.current !== controller || offRouteRef.current !== 'alert';
    void proposeReroute(
      rerouterRef.current,
      controller,
      refAnalysisRef.current,
      activeSpeedSettings(),
    )
      .then((r) => {
        if (isStale()) return;
        if (r.result === 'proposed') {
          setRerouteProposal(r.proposal);
          setReroutePhase('preview');
        } else if (r.result === 'near-finish') {
          // NAVIGATION_SPEC §3: never reroute to the finish — retrying can't change this.
          setRerouteError({
            message: 'Too close to the finish to reroute — follow the arrow back to the track.',
            retryable: false,
          });
          setReroutePhase('error');
        } else {
          setRerouteError({
            message: 'Could not fetch a reroute (offline or quota). You can retry.',
            retryable: true,
          });
          setReroutePhase('error');
        }
      })
      .catch(() => {
        if (isStale()) return; // rejoined / ended / new ride mid-fetch — nothing to report
        setRerouteError({
          message: 'Could not fetch a reroute (offline or quota). You can retry.',
          retryable: true,
        });
        setReroutePhase('error');
      })
      .finally(() => {
        reroutingRef.current = false;
      });
  }, []);

  // Rider accepted the previewed route: NOW swap it into the controller and into everything the
  // screen renders (map line, ribbon, gust markers). The controller announces "New route".
  const acceptReroute = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller || !rerouteProposal) return;
    controller.applyReroute(rerouteProposal.analysis);
    // applyReroute restarts progress at 0 with the spliced leg's first step metres away, so the
    // junction zoom would slam to its tightest on the very next fix — while the map may also be
    // rotating most of the way round. Sit the approach out for a few fixes.
    rerouteSettleRef.current = REROUTE_SETTLE_FIXES;
    setLiveAnalysis(rerouteProposal.analysis);
    setRerouteProposal(null);
    setRerouteError(null);
    setReroutePhase('idle');
    rerouteDeclinedRef.current = false;
    setFollowing(true); // snap the camera back to the rider on the fresh route
  }, [rerouteProposal]);

  // "No thanks" / "Keep current" / error dismiss: stay on the planned route, keep the bearing-to-
  // track arrow, and don't ask again until the rider has been back on the route once.
  const dismissReroute = useCallback(() => {
    rerouteDeclinedRef.current = true;
    setRerouteProposal(null);
    setRerouteError(null);
    setReroutePhase('idle');
  }, []);

  // Device-compass heading (task #32). MUST run inside the Start/Resume gesture — iOS gates the
  // sensor behind requestPermission(), which only works from a user activation. Denial/unsupported
  // is silent: the GPS travel bearing still drives the arrow.
  const startCompass = useCallback(() => {
    compassRef.current?.stop(); // never leave a prior stream running
    const compass = new CompassHeadingSource();
    compassRef.current = compass;
    void CompassHeadingSource.requestPermission().then((perm) => {
      if (perm !== 'granted' || compassRef.current !== compass) return; // denied, or superseded
      compass.start((deg) => {
        // Every reading reaches the controller (it keeps the blend exact); only ~8 per second reach
        // React — see MAP_HEADING_MIN_INTERVAL_MS.
        const blended = controllerRef.current?.setCompassHeading(deg);
        if (blended == null) return;
        const now = Date.now();
        if (now - lastHeadingPushRef.current < MAP_HEADING_MIN_INTERVAL_MS) return;
        lastHeadingPushRef.current = now;
        setMapHeading(blended);
      });
    });
  }, []);

  // Mid-ride mute (DEC-055 map sound button). Unmuting a ride that STARTED silent falls back to
  // voice — the button exists to hear cues. setMode is the announcer's public switch.
  const toggleMute = useCallback(() => {
    const announcer = announcerRef.current;
    if (!announcer) return;
    setMuted((m) => {
      const next = !m;
      announcer.setMode(next ? 'silent' : cueMode === 'silent' ? 'voice' : cueMode);
      return next;
    });
  }, [cueMode]);

  const start = useCallback(() => {
    if (!scored) return;
    const announcer = armAudio(cueMode); // unlock audio on this user gesture
    announcerRef.current = announcer;
    setMuted(cueMode === 'silent');
    controllerRef.current = new RideController({ analysis: scored.analysis, announcer });
    rerouterRef.current = makeRerouter();
    refAnalysisRef.current = scored.analysis; // original forecast wind, for reroute re-analysis
    reroutingRef.current = false;
    rerouteDeclinedRef.current = false;
    offRouteRef.current = 'on-route'; // stale-guard baseline: kills any prior ride's late fetch
    offTrackStreakRef.current = 0;
    rerouteSettleRef.current = 0;
    setReroutePhase('idle');
    setRerouteProposal(null);
    setRerouteError(null);
    setLiveAnalysis(null); // a fresh ride navigates the plan, not a previous ride's reroute
    const name = `WindRide ${scored.evidence.distanceKm.toFixed(0)} km`;
    recorderRef.current = new IdbRideRecorder({
      rideId: crypto.randomUUID(),
      name,
      startedAt: Date.now(),
      routeId: scored.candidate.id, // plan linkage — WR-024/WR-028 need it
      analysis: scored.analysis,
      medianHeadwindKm: median(ranked.map((r) => r.evidence.headwindKm)),
      chosenHeadwindKm: scored.evidence.headwindKm,
    });
    recorderRef.current.start();
    setStatus('riding');
    setFollowing(true); // start locked onto the rider
    setGpsError(null);
    // Live GPS; the dev replay panel can also drive handleFix.
    const source = new GeolocationSource();
    sourceRef.current = source;
    source.start(handleFix, (err) => setGpsError(err.message || 'Location unavailable'));
    startCompass(); // still inside the Start gesture — required for the iOS permission prompt
  }, [scored, cueMode, handleFix, ranked, startCompass]);

  const pause = useCallback(() => {
    controllerRef.current?.pause();
    recorderRef.current.pause();
    setStatus('paused');
  }, []);

  const resume = useCallback(() => {
    controllerRef.current?.resume();
    recorderRef.current.resume();
    setStatus('riding');
    setFollowing(true);
  }, []);

  const downloadGpx = (gpx: string, distanceM: number) => {
    if (gpx)
      downloadText(gpxFilename(distanceM / 1000, localYMD(new Date())), 'application/gpx+xml', gpx);
  };

  const end = useCallback(() => {
    sourceRef.current?.stop();
    compassRef.current?.stop();
    compassRef.current = null; // so a late requestPermission() resolve can't re-arm the sensor
    controllerRef.current?.pause();
    const analysis = scored?.analysis;
    void recorderRef.current.finish().then(({ gpx, summary, points }) => {
      downloadGpx(gpx, summary.distanceM);
      // Feed the finished ride to speed-model calibration (WR-024). Aggregates only; the owner
      // must apply any resulting model explicitly from Settings — planning never changes silently.
      if (analysis) useCalibrationStore.getState().recordRide(analysis, points);
      // Remember the ridden roads for the Novelty sub-score (WR-028) — recordings only.
      void useNoveltyStore.getState().recordRide(points);
      void refreshRides();
    });
    // A reroute conversation can't outlive the ride it belongs to — including a fetch still in
    // flight: resetting offRouteRef makes the confirm callback's stale-guard discard its result.
    offRouteRef.current = 'on-route';
    offTrackStreakRef.current = 0;
    rerouteSettleRef.current = 0;
    setReroutePhase('idle');
    setRerouteProposal(null);
    setRerouteError(null);
    setStatus('ended');
  }, [refreshRides, scored]);

  const saveUnfinished = useCallback(() => {
    if (!unfinished) return;
    void saveUnfinishedRide(unfinished).then(({ gpx, summary, points }) => {
      downloadGpx(gpx, summary.distanceM);
      // A crash-recovered ride is still a real recording — record its roads for Novelty (WR-028).
      void useNoveltyStore.getState().recordRide(points);
      setUnfinished(null);
      void refreshRides();
    });
  }, [unfinished, refreshRides]);

  const discardUnfinished = useCallback(() => {
    if (!unfinished) return;
    void deleteRide(unfinished.id).then(() => setUnfinished(null));
  }, [unfinished]);

  // Resume a crash-interrupted ride — only when its planned route is still loaded this session
  // (after a reload the analysis is gone, so the prompt offers Save instead).
  const canResume = !!unfinished && !!scored && unfinished.routeId === scored.candidate.id;
  const resumeUnfinished = useCallback(() => {
    if (!unfinished || !scored) return;
    startCompass(); // request the compass now, while still in the Resume gesture (iOS requirement)
    void loadRidePoints(unfinished.id).then((resumePoints) => {
      const announcer = armAudio(cueMode);
      announcerRef.current = announcer;
      setMuted(cueMode === 'silent');
      controllerRef.current = new RideController({
        analysis: scored.analysis,
        announcer,
        resumePath: resumePoints, // seed the snapper at the rider's real progress, not the start
      });
      rerouterRef.current = makeRerouter();
      refAnalysisRef.current = scored.analysis;
      reroutingRef.current = false;
      rerouteDeclinedRef.current = false;
      offRouteRef.current = 'on-route';
      offTrackStreakRef.current = 0;
      rerouteSettleRef.current = 0;
      setReroutePhase('idle');
      setRerouteProposal(null);
      setRerouteError(null);
      setLiveAnalysis(null);
      recorderRef.current = new IdbRideRecorder({
        rideId: unfinished.id, // keep the existing recording row — do NOT call start()
        name: unfinished.name,
        startedAt: unfinished.startedAt,
        routeId: scored.candidate.id,
        analysis: scored.analysis,
        medianHeadwindKm: median(ranked.map((r) => r.evidence.headwindKm)),
        chosenHeadwindKm: scored.evidence.headwindKm,
        resumePoints,
      });
      setUnfinished(null);
      setStatus('riding');
      setFollowing(true);
      const source = new GeolocationSource();
      sourceRef.current = source;
      source.start(handleFix, (err) => setGpsError(err.message || 'Location unavailable'));
    });
  }, [unfinished, scored, ranked, cueMode, handleFix, startCompass]);

  const unfinishedPrompt = unfinished ? (
    <div className="wr-ride__resume" role="alertdialog" aria-label="Unfinished ride">
      <span>Unfinished ride from {localYMD(new Date(unfinished.startedAt))} found.</span>
      <div className="wr-ride__controls">
        {canResume ? <PrimaryButton onClick={resumeUnfinished}>Resume</PrimaryButton> : null}
        <button type="button" className="wr-btn-secondary" onClick={saveUnfinished}>
          Save it
        </button>
        <button type="button" className="wr-btn-secondary" onClick={discardUnfinished}>
          Discard
        </button>
      </div>
    </div>
  ) : null;

  if (!scored) {
    return (
      <div className="wr-ride wr-ride--empty">
        <p className="wr-muted">Pick a route on the Results screen, then start your ride.</p>
        <a className="wr-navlink" href="#/results">
          ← Results
        </a>
        {unfinishedPrompt}
        <RideHistory />
      </div>
    );
  }

  const riding = status === 'riding' || status === 'paused';

  // The map + its overlays (zoom, alerts) — identical in the idle preview and the live full-screen
  // view; only the container class differs.
  const mapEl = (
    <div className={`wr-ride__map${riding ? ' wr-ride__map--full' : ''}`}>
      <RideMap
        scored={liveScored ?? scored}
        rider={rider}
        previewPolyline={
          reroutePhase === 'preview' ? (rerouteProposal?.previewPolyline ?? null) : null
        }
        batterySaver={batterySaver}
        zoomM={zoomM}
        following={following}
        onFollowChange={setFollowing}
        headingUp={headingUp}
        mapBearingDeg={mapBearingDeg}
        insets={insets}
        junction={junctionArrow}
      />
      {rideState ? (
        <div className="wr-ride__mapbtns">
          {following ? (
            <>
              <button type="button" className="wr-mapbtn" aria-label="Zoom in" onClick={zoomIn}>
                +
              </button>
              <button type="button" className="wr-mapbtn" aria-label="Zoom out" onClick={zoomOut}>
                −
              </button>
              {manualZoomM !== null ? (
                <button
                  type="button"
                  className="wr-mapbtn wr-mapbtn--text"
                  aria-label="Auto zoom"
                  onClick={() => setManualZoomM(null)}
                >
                  Auto
                </button>
              ) : null}
            </>
          ) : (
            // Free-look: pinch/drag control the view; this snaps back to following the rider.
            <button
              type="button"
              className="wr-mapbtn"
              aria-label="Recenter map on rider"
              onClick={() => setFollowing(true)}
            >
              <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true">
                <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                <path
                  d="M12 2 v4 M12 18 v4 M2 12 h4 M18 12 h4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
          {/* Heading-up ↔ north-up (WR-053). The needle shows where north is on screen, so the
              rider can always re-orient; a stable label + aria-pressed keeps the state announced
              once rather than twice. */}
          <button
            type="button"
            className="wr-mapbtn"
            aria-label="Rotate map to my heading"
            aria-pressed={headingUp}
            onClick={toggleMapOrientation}
          >
            <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true">
              {/* The needle turns to keep pointing at true north; in north-up it rests upright. */}
              <g
                style={{ transform: `rotate(${-appliedBearingDeg}deg)`, transformOrigin: 'center' }}
              >
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  opacity="0.45"
                />
                <path d="M12 4 L15.5 12 L12 10 L8.5 12 Z" fill="currentColor" />
                <path
                  d="M12 20 L8.5 12 L12 14 L15.5 12 Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
              </g>
              {/* Heading-up adds a fixed pip at screen-top ("up is you"). The pressed state must not
                  rest on colour alone (WCAG 1.4.1) — and the needle alone is identical in both modes
                  whenever the rider happens to be heading due north. */}
              {headingUp ? <path d="M9.4 1.9 L12 0.2 L14.6 1.9 Z" fill="currentColor" /> : null}
            </svg>
          </button>
          {riding ? (
            <button
              type="button"
              className="wr-mapbtn"
              aria-label={muted ? 'Unmute cues' : 'Mute cues'}
              aria-pressed={muted}
              onClick={toggleMute}
            >
              <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true">
                <path d="M4 9 v6 h4 l5 4 V5 L8 9 Z" fill="currentColor" />
                {muted ? (
                  <path
                    d="M16 9 l5 6 M21 9 l-5 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                ) : (
                  <path
                    d="M16 9 a4 4 0 0 1 0 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                )}
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}
      {/* Only while there is a rider to orient — on the idle route preview nothing rotates, so
          announcing an orientation there would be untrue. */}
      {rideState ? (
        <span className="wr-visually-hidden" role="status">
          {orientationLabel}
        </span>
      ) : null}
      {rideState?.offRoute === 'alert' && rideState.toTrack ? (
        <div className="wr-ride__alert" role="alert">
          <svg
            viewBox="0 0 24 24"
            width={22}
            height={22}
            aria-hidden="true"
            style={{
              transform: `rotate(${rideState.toTrack.bearingDeg - (rideState.headingDeg ?? 0)}deg)`,
            }}
          >
            <path d="M12 2 L18 20 L12 16 L6 20 Z" fill="currentColor" />
          </svg>
          Off route — {Math.round(rideState.toTrack.distanceM)} m to the track
        </div>
      ) : null}
      {reroutePhase !== 'idle' ? (
        // Confirm-first reroute dialog (WR-051): nothing is fetched or applied without a tap.
        <div className="wr-ride__reroute" role="alertdialog" aria-label="Reroute">
          {reroutePhase === 'offer' ? (
            <>
              <span>You’re off route — reroute back to your planned route?</span>
              <div className="wr-ride__controls">
                <PrimaryButton onClick={confirmReroute}>Reroute</PrimaryButton>
                <button type="button" className="wr-btn-secondary" onClick={dismissReroute}>
                  No thanks
                </button>
              </div>
            </>
          ) : null}
          {reroutePhase === 'loading' ? <span>Finding a way back to your route…</span> : null}
          {reroutePhase === 'preview' ? (
            <>
              <span>
                New route found (dashed line) — it rejoins your planned route ahead. Accept?
              </span>
              <div className="wr-ride__controls">
                <PrimaryButton onClick={acceptReroute}>Accept</PrimaryButton>
                <button type="button" className="wr-btn-secondary" onClick={dismissReroute}>
                  Keep current
                </button>
              </div>
            </>
          ) : null}
          {reroutePhase === 'error' && rerouteError ? (
            <>
              <span>{rerouteError.message}</span>
              <div className="wr-ride__controls">
                {rerouteError.retryable ? (
                  <PrimaryButton onClick={confirmReroute}>Retry</PrimaryButton>
                ) : null}
                <button type="button" className="wr-btn-secondary" onClick={dismissReroute}>
                  Dismiss
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {gpsError ? (
        <div className="wr-ride__alert" role="alert">
          {gpsError}
        </div>
      ) : null}
      {recError ? (
        <div className="wr-ride__alert" role="alert">
          Ride isn’t being saved — storage error
        </div>
      ) : null}
      {rideState?.gustAhead ? (
        // role=status (polite) + no changing distance in the text, so a screen reader isn't
        // re-announced every fix on approach; the one-shot voice cue already gave the distance.
        <div className="wr-ride__alert" role="status">
          ⚠ Crosswind gusts up to {Math.round(rideState.gustAhead.maxGustMs)} m/s{' '}
          {rideState.gustAhead.inM <= 0 ? 'now' : 'ahead'}
        </div>
      ) : null}
    </div>
  );

  // The wind-along-route ribbon + progress dot (shared by the details sheet and the idle view).
  const ribbonEl = (
    <div className="wr-ride__ribbon">
      <WindRibbon segments={ribbon} height={16} />
      <span className="wr-ride__dot" style={{ left: `${dotFraction * 100}%` }} aria-hidden="true" />
    </div>
  );

  // ---- Live full-screen ride (DEC-055, per the nav reference): the map owns the screen. A
  // next-turn card floats at the top, the wind chip rides the map edge, and a bottom panel holds
  // the honest numbers (speed / remaining / time left / arrival) with the rest behind Details.
  if (riding) {
    const nextTurn = rideState?.nextTurn ?? null;
    return (
      <div className="wr-ride wr-ride--live">
        {mapEl}

        {nextTurn ? (
          <div className="wr-ride__turncard" aria-label="Next turn">
            <span className="wr-ride__turnicon" aria-hidden="true">
              <TurnGlyph kind={nextTurn.kind} />
            </span>
            <div className="wr-ride__turnbody">
              <span className="wr-ride__turn-dist tabular">{formatTurnDist(nextTurn.inM)}</span>
              <span className="wr-ride__turn-instr">{nextTurn.instruction}</span>
            </div>
            {/* A second maneuver follows immediately — the voice says it in the same breath, so the
                card shows it too rather than leaving the rider to be surprised by it. */}
            {nextTurn.thenKind ? (
              <span className="wr-ride__turnthen" aria-hidden="true">
                <TurnGlyph kind={nextTurn.thenKind} size={18} />
              </span>
            ) : null}
          </div>
        ) : null}

        {rideState?.wind ? (
          <div className="wr-ride__windchip">
            <WindHud
              wind={rideState.wind}
              headingDeg={rideState.headingDeg}
              transition={rideState.windTransition}
            />
          </div>
        ) : null}

        <div className="wr-ride__panel">
          <div className="wr-ride__glancebar" role="group" aria-label="Ride stats">
            <div className="wr-ride__cell wr-ride__cell--speed">
              <b className="tabular">{rideState ? Math.round(rideState.speedKmh) : '—'}</b>
              <small>km/h</small>
            </div>
            <div className="wr-ride__cell">
              <b className="tabular">
                {rideState
                  ? metresToKm(rideState.remainingM)
                  : metresToKm(scored.candidate.distanceM)}
              </b>
              <small>km left</small>
            </div>
            <div className="wr-ride__cell">
              <b className="tabular">{rideState ? formatDurationHM(rideState.etaS) : '—'}</b>
              <small>time left</small>
            </div>
            <div className="wr-ride__cell">
              <b className="tabular">{rideState ? arrivalClock(rideState.etaS) : '—'}</b>
              <small>arrival</small>
            </div>
          </div>

          {detailsOpen ? (
            <div className="wr-ride__sheet">
              <div className="wr-ride__glance">
                <StatCell
                  label="km ridden"
                  value={rideState ? metresToKm(rideState.progressM) : 0}
                />
                <StatCell label="route km" value={metresToKm(scored.candidate.distanceM)} />
              </div>
              {ribbonEl}
              <label className="wr-ride__saver">
                <input
                  type="checkbox"
                  checked={batterySaver}
                  onChange={(e) => setBatterySaver(e.target.checked)}
                />
                Battery saver
              </label>
              {import.meta.env.DEV ? (
                <Suspense fallback={null}>
                  <DevReplayPanel onFix={handleFix} />
                </Suspense>
              ) : null}
            </div>
          ) : null}

          <div className="wr-ride__livebar">
            <button
              type="button"
              className="wr-btn-secondary"
              onClick={() => setDetailsOpen((o) => !o)}
              aria-expanded={detailsOpen}
            >
              {detailsOpen ? 'Hide details' : 'Details'}
            </button>
            {status === 'riding' ? (
              <PrimaryButton className="wr-ride__ridebtn" onClick={pause}>
                Pause
              </PrimaryButton>
            ) : (
              <PrimaryButton className="wr-ride__ridebtn" onClick={resume}>
                Resume
              </PrimaryButton>
            )}
            <button type="button" className="wr-btn-secondary" onClick={end}>
              End
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Idle / ended: route preview + start controls, ride history, and (dev) the replay panel.
  return (
    <div className="wr-ride">
      {mapEl}

      <WindHud
        wind={rideState?.wind ?? null}
        headingDeg={rideState?.headingDeg ?? null}
        transition={rideState?.windTransition ?? null}
      />

      <div className="wr-ride__glance">
        <StatCell label="km/h" value="—" />
        <StatCell label="ETA" value={rideState ? formatDurationHM(rideState.etaS) : '—'} />
        <StatCell label="km" value={metresToKm(scored.candidate.distanceM)} />
      </div>

      {ribbonEl}

      <div className="wr-ride__controls">
        {status === 'idle' ? <WinterCaution winter={winter} /> : null}
        {status === 'idle' ? (
          <>
            <Segmented
              ariaLabel="Cue mode"
              value={cueMode}
              onChange={(m) => setCueMode(m)}
              options={[
                { value: 'voice', label: 'Voice' },
                { value: 'beep', label: 'Beep' },
                { value: 'silent', label: 'Silent' },
              ]}
            />
            <PrimaryButton onClick={start}>Start ride</PrimaryButton>
          </>
        ) : null}
        {status === 'ended' ? (
          <a className="wr-navlink" href="#/results">
            Ride ended · back to Results
          </a>
        ) : null}
        <label className="wr-ride__saver">
          <input
            type="checkbox"
            checked={batterySaver}
            onChange={(e) => setBatterySaver(e.target.checked)}
          />
          Battery saver
        </label>
      </div>

      {status === 'idle' ? unfinishedPrompt : null}
      {status === 'idle' || status === 'ended' ? <RideHistory /> : null}

      {import.meta.env.DEV ? (
        <Suspense fallback={null}>
          <DevReplayPanel onFix={handleFix} />
        </Suspense>
      ) : null}
    </div>
  );
}
