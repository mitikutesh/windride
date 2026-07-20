import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteRide, getRecordingRide, type RecordedRide } from '../../data/db';
import { armAudio, type CueMode } from '../../nav/announcer';
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
import { attemptReroute } from '../../nav/reroute';
import { RideController, type RideState } from '../../nav/rideController';
import type { CandidateAnalysis } from '../../engine/scoring';
import { activeSpeedSettings, useCalibrationStore } from '../../state/calibrationStore';
import { useNoveltyStore } from '../../state/noveltyStore';
import { makeRerouter } from '../../state/rerouter';
import { useResultsStore } from '../../state/resultsStore';
import { useRidesStore } from '../../state/ridesStore';
import { gpxFilename } from '../../utils/gpx';
import { formatDurationHM, localYMD, metresToKm } from '../../utils/units';
import { PrimaryButton, Segmented, StatCell, WindRibbon } from '../components';
import { RideHistory } from '../components/RideHistory';
import { RideMap } from '../components/RideMap';
import { WindHud } from '../components/WindHud';
import { WinterCaution } from '../components/WinterCaution';
import { downloadText } from '../download';
import { routeToRibbon } from '../routeGeo';
import { windColor } from '../windColors';
import { useWakeLock } from '../useWakeLock';

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const DevReplayPanel = lazy(() => import('../components/DevReplayPanel'));

/** Min gap between reroutes (success or failure) — protects the ORS free-tier budget when lost. */
const REROUTE_COOLDOWN_MS = 20_000;

type RideStatus = 'idle' | 'riding' | 'paused' | 'ended';

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
  // Freshest blended heading for the map arrow (task #32) — refreshed per fix and, between fixes,
  // by compass events so the arrow swings when a stopped rider turns the phone.
  const [mapHeading, setMapHeading] = useState<number | null>(null);
  // Auto-reroute (DEC-022 wiring): a Rerouter, the ORIGINAL plan analysis (for reference wind), an
  // in-flight guard, and a backoff clock so a failed attempt doesn't hammer the router.
  const rerouterRef = useRef<Rerouter | null>(null);
  const refAnalysisRef = useRef<CandidateAnalysis | null>(null);
  const reroutingRef = useRef(false);
  const rerouteRetryAtRef = useRef(0);

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

  const ribbon = useMemo(() => (scored ? routeToRibbon(scored) : []), [scored]);
  // The ribbon is laid out by TIME share, so the dot must use the modelled time fraction, not
  // distance — otherwise it sits in the wrong wind band on headwind/tailwind routes.
  const dotFraction = rideState?.timeFraction ?? 0;

  // Follow-the-rider map zoom (metres across the view). Auto-scales with speed — see further ahead
  // when fast, tighter detail when slow/stopped — until the rider zooms manually (Auto restores it).
  const [manualZoomM, setManualZoomM] = useState<number | null>(null);
  const autoZoomM = Math.round(
    Math.max(250, Math.min(1600, 250 + (rideState?.speedKmh ?? 0) * 40)),
  );
  const zoomM = manualZoomM ?? autoZoomM;
  const zoomIn = () => setManualZoomM((z) => Math.max(120, Math.round((z ?? autoZoomM) / 1.6)));
  const zoomOut = () => setManualZoomM((z) => Math.min(4000, Math.round((z ?? autoZoomM) * 1.6)));

  // Follow-the-rider camera vs free-look. The map flips this to false when the rider drags/pinches
  // to look around; the Recenter control puts it back. Reset to true whenever a ride (re)starts.
  const [following, setFollowing] = useState(true);

  // While riding the map goes full-screen with a minimal HUD; the rest of the numbers live behind
  // a Details toggle so the map dominates (the thing you actually look at on the bike).
  const [detailsOpen, setDetailsOpen] = useState(false);

  const handleFix = useCallback((fix: Fix) => {
    const controller = controllerRef.current;
    if (!controller) return;
    recorderRef.current.addFix(fix);
    if (recorderRef.current.lastError) setRecError(true); // recording stopped persisting
    const state = controller.onFix(fix);
    setRideState(state);
    setMapHeading(state.headingDeg); // per-fix blended heading; compass events refine it between fixes

    // Sustained off-route WHILE ACTIVELY RIDING ⇒ fetch a fresh leg, splice + re-analyse it, and swap
    // the route in (DEC-022). One attempt in flight at a time; success + failure both cool down
    // (never hammer the router / blow the free-tier budget); near-finish stops retrying. `paused`
    // covers both pause and end (end() pauses the controller), so a reroute never fires or applies
    // once the rider stops.
    if (
      state.offRoute === 'alert' &&
      !controller.paused &&
      rerouterRef.current &&
      refAnalysisRef.current &&
      !reroutingRef.current &&
      Date.now() >= rerouteRetryAtRef.current
    ) {
      reroutingRef.current = true;
      void attemptReroute(
        rerouterRef.current,
        controller,
        refAnalysisRef.current,
        activeSpeedSettings(),
        () => !controller.paused, // don't apply/announce if the ride paused/ended mid-fetch
      )
        .then((r) => {
          if (r.result === 'rerouted') rerouteRetryAtRef.current = Date.now() + REROUTE_COOLDOWN_MS;
          else if (r.result === 'failed')
            rerouteRetryAtRef.current = Date.now() + (r.nextRetryMs ?? 5000);
          else if (r.result === 'near-finish') rerouteRetryAtRef.current = Number.POSITIVE_INFINITY;
        })
        .catch(() => {
          rerouteRetryAtRef.current = Date.now() + 5000;
        })
        .finally(() => {
          reroutingRef.current = false;
        });
    }
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
        const blended = controllerRef.current?.setCompassHeading(deg);
        if (blended != null) setMapHeading(blended);
      });
    });
  }, []);

  const start = useCallback(() => {
    if (!scored) return;
    const announcer = armAudio(cueMode); // unlock audio on this user gesture
    controllerRef.current = new RideController({ analysis: scored.analysis, announcer });
    rerouterRef.current = makeRerouter();
    refAnalysisRef.current = scored.analysis; // original forecast wind, for reroute re-analysis
    reroutingRef.current = false;
    rerouteRetryAtRef.current = 0;
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
      controllerRef.current = new RideController({ analysis: scored.analysis, announcer });
      rerouterRef.current = makeRerouter();
      refAnalysisRef.current = scored.analysis;
      reroutingRef.current = false;
      rerouteRetryAtRef.current = 0;
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
        scored={scored}
        rider={
          rideState
            ? { position: rideState.snapped, headingDeg: mapHeading ?? rideState.headingDeg }
            : null
        }
        batterySaver={batterySaver}
        zoomM={zoomM}
        following={following}
        onFollowChange={setFollowing}
      />
      {rideState ? (
        <div className="wr-ride__zoom">
          {following ? (
            <>
              <button type="button" aria-label="Zoom out" onClick={zoomOut}>
                −
              </button>
              <button type="button" aria-label="Zoom in" onClick={zoomIn}>
                +
              </button>
              {manualZoomM !== null ? (
                <button
                  type="button"
                  className="wr-ride__zoom-auto"
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
              className="wr-ride__zoom-auto wr-ride__recenter"
              aria-label="Recenter map on rider"
              onClick={() => setFollowing(true)}
            >
              Recenter
            </button>
          )}
        </div>
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

  // ---- Live full-screen ride: map fills the screen, a minimal HUD on top, the rest behind Details.
  if (riding) {
    return (
      <div className="wr-ride wr-ride--live">
        {mapEl}

        <div className="wr-ride__hud">
          <div className="wr-ride__hud-speed">
            <span className="tabular">{rideState ? Math.round(rideState.speedKmh) : '—'}</span>
            <small>km/h</small>
          </div>
          <div className="wr-ride__hud-cells">
            <div>
              <b className="tabular">
                {rideState
                  ? metresToKm(rideState.remainingM)
                  : metresToKm(scored.candidate.distanceM)}
              </b>
              <small>km left</small>
            </div>
            <div>
              <b className="tabular">{rideState ? formatDurationHM(rideState.etaS) : '—'}</b>
              <small>ETA</small>
            </div>
          </div>
          {rideState?.wind ? (
            <div className="wr-ride__hud-wind" aria-label={`Wind: ${rideState.wind.kind}`}>
              <svg
                viewBox="0 0 24 24"
                width={34}
                height={34}
                aria-hidden="true"
                style={{
                  transform: `rotate(${rideState.wind.windToDeg - (rideState.headingDeg ?? 0)}deg)`,
                }}
              >
                <path d="M12 2 L18 20 L12 16 L6 20 Z" fill={windColor(rideState.wind.kind)} />
              </svg>
            </div>
          ) : null}
        </div>

        {rideState?.nextTurn ? (
          <div className="wr-ride__turn wr-ride__turn--overlay" aria-label="Next turn">
            <span className="wr-ride__turn-dist tabular">
              {metresToKm(rideState.nextTurn.inM, rideState.nextTurn.inM < 1000 ? 2 : 1)} km
            </span>
            <span className="wr-ride__turn-instr">{rideState.nextTurn.instruction}</span>
          </div>
        ) : null}

        {detailsOpen ? (
          <div className="wr-ride__sheet">
            <div className="wr-ride__glance">
              <StatCell label="km/h" value={rideState ? Math.round(rideState.speedKmh) : '—'} />
              <StatCell label="km ridden" value={rideState ? metresToKm(rideState.progressM) : 0} />
              <StatCell label="ETA" value={rideState ? formatDurationHM(rideState.etaS) : '—'} />
            </div>
            <WindHud
              wind={rideState?.wind ?? null}
              headingDeg={rideState?.headingDeg ?? null}
              transition={rideState?.windTransition ?? null}
            />
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
            <button type="button" className="wr-btn-secondary" onClick={pause}>
              Pause
            </button>
          ) : (
            <PrimaryButton onClick={resume}>Resume</PrimaryButton>
          )}
          <button type="button" className="wr-btn-secondary" onClick={end}>
            End
          </button>
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
