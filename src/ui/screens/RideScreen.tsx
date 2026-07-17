import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteRide, getRecordingRide, type RecordedRide } from '../../data/db';
import { armAudio, type CueMode } from '../../nav/announcer';
import type { Fix } from '../../nav/fixSource';
import { GeolocationSource } from '../../nav/locationService';
import {
  IdbRideRecorder,
  loadRidePoints,
  nullRecorder,
  saveUnfinishedRide,
  type RideRecorder,
} from '../../nav/recorder';
import { RideController, type RideState } from '../../nav/rideController';
import { useCalibrationStore } from '../../state/calibrationStore';
import { useResultsStore } from '../../state/resultsStore';
import { useRidesStore } from '../../state/ridesStore';
import { gpxFilename } from '../../utils/gpx';
import { formatDurationHM, localYMD, metresToKm } from '../../utils/units';
import { PrimaryButton, Segmented, StatCell, WindRibbon } from '../components';
import { RideHistory } from '../components/RideHistory';
import { RideMap } from '../components/RideMap';
import { WindHud } from '../components/WindHud';
import { downloadText } from '../download';
import { routeToRibbon } from '../routeGeo';
import { useWakeLock } from '../useWakeLock';

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const DevReplayPanel = lazy(() => import('../components/DevReplayPanel'));

type RideStatus = 'idle' | 'riding' | 'paused' | 'ended';

/**
 * Ride screen (WR-016): the saddle UI — wind-coloured map, next-turn card, wind HUD, and a glance
 * zone of huge honest numbers. Wires the FixSource (live GPS or the replay dev panel) through the
 * RideController, holds a wake lock while riding, and offers a battery-saver mode.
 */
export function RideScreen() {
  const ranked = useResultsStore((s) => s.ranked);
  const scored = useResultsStore((s) => s.ranked.find((r) => r.candidate.id === s.selectedId));
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
      controllerRef.current?.pause();
      void recorderRef.current.flush();
    },
    [],
  );

  const ribbon = useMemo(() => (scored ? routeToRibbon(scored) : []), [scored]);
  // The ribbon is laid out by TIME share, so the dot must use the modelled time fraction, not
  // distance — otherwise it sits in the wrong wind band on headwind/tailwind routes.
  const dotFraction = rideState?.timeFraction ?? 0;

  const handleFix = useCallback((fix: Fix) => {
    const controller = controllerRef.current;
    if (!controller) return;
    recorderRef.current.addFix(fix);
    if (recorderRef.current.lastError) setRecError(true); // recording stopped persisting
    setRideState(controller.onFix(fix));
  }, []);

  const start = useCallback(() => {
    if (!scored) return;
    const announcer = armAudio(cueMode); // unlock audio on this user gesture
    controllerRef.current = new RideController({ analysis: scored.analysis, announcer });
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
    setGpsError(null);
    // Live GPS; the dev replay panel can also drive handleFix.
    const source = new GeolocationSource();
    sourceRef.current = source;
    source.start(handleFix, (err) => setGpsError(err.message || 'Location unavailable'));
  }, [scored, cueMode, handleFix, ranked]);

  const pause = useCallback(() => {
    controllerRef.current?.pause();
    recorderRef.current.pause();
    setStatus('paused');
  }, []);

  const resume = useCallback(() => {
    controllerRef.current?.resume();
    recorderRef.current.resume();
    setStatus('riding');
  }, []);

  const downloadGpx = (gpx: string, distanceM: number) => {
    if (gpx)
      downloadText(gpxFilename(distanceM / 1000, localYMD(new Date())), 'application/gpx+xml', gpx);
  };

  const end = useCallback(() => {
    sourceRef.current?.stop();
    controllerRef.current?.pause();
    const analysis = scored?.analysis;
    void recorderRef.current.finish().then(({ gpx, summary, points }) => {
      downloadGpx(gpx, summary.distanceM);
      // Feed the finished ride to speed-model calibration (WR-024). Aggregates only; the owner
      // must apply any resulting model explicitly from Settings — planning never changes silently.
      if (analysis) useCalibrationStore.getState().recordRide(analysis, points);
      void refreshRides();
    });
    setStatus('ended');
  }, [refreshRides, scored]);

  const saveUnfinished = useCallback(() => {
    if (!unfinished) return;
    void saveUnfinishedRide(unfinished).then(({ gpx, summary }) => {
      downloadGpx(gpx, summary.distanceM);
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
    void loadRidePoints(unfinished.id).then((resumePoints) => {
      const announcer = armAudio(cueMode);
      controllerRef.current = new RideController({ analysis: scored.analysis, announcer });
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
      const source = new GeolocationSource();
      sourceRef.current = source;
      source.start(handleFix, (err) => setGpsError(err.message || 'Location unavailable'));
    });
  }, [unfinished, scored, ranked, cueMode, handleFix]);

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

  return (
    <div className="wr-ride">
      <div className="wr-ride__map">
        <RideMap
          scored={scored}
          rider={
            rideState ? { position: rideState.snapped, headingDeg: rideState.headingDeg } : null
          }
          batterySaver={batterySaver}
        />
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

      {rideState?.nextTurn ? (
        <div className="wr-ride__turn" aria-label="Next turn">
          <span className="wr-ride__turn-dist tabular">
            {metresToKm(rideState.nextTurn.inM, rideState.nextTurn.inM < 1000 ? 2 : 1)} km
          </span>
          <span className="wr-ride__turn-instr">{rideState.nextTurn.instruction}</span>
        </div>
      ) : null}

      <WindHud
        wind={rideState?.wind ?? null}
        headingDeg={rideState?.headingDeg ?? null}
        transition={rideState?.windTransition ?? null}
      />

      <div className="wr-ride__glance">
        <StatCell label="km/h" value={rideState ? Math.round(rideState.speedKmh) : '—'} />
        <StatCell label="ETA" value={rideState ? formatDurationHM(rideState.etaS) : '—'} />
        <StatCell
          label="km left"
          value={
            rideState ? metresToKm(rideState.remainingM) : metresToKm(scored.candidate.distanceM)
          }
        />
      </div>

      <div className="wr-ride__ribbon">
        <WindRibbon segments={ribbon} height={16} />
        <span
          className="wr-ride__dot"
          style={{ left: `${dotFraction * 100}%` }}
          aria-hidden="true"
        />
      </div>

      <div className="wr-ride__controls">
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
        {status === 'riding' ? (
          <button type="button" className="wr-btn-secondary" onClick={pause}>
            Pause
          </button>
        ) : null}
        {status === 'paused' ? <PrimaryButton onClick={resume}>Resume</PrimaryButton> : null}
        {riding ? (
          <button type="button" className="wr-btn-secondary" onClick={end}>
            End ride
          </button>
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
