import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { armAudio, type CueMode } from '../../nav/announcer';
import type { Fix } from '../../nav/fixSource';
import { GeolocationSource } from '../../nav/locationService';
import { nullRecorder, type RideRecorder } from '../../nav/recorder';
import { RideController, type RideState } from '../../nav/rideController';
import { useResultsStore } from '../../state/resultsStore';
import { formatDurationHM, metresToKm } from '../../utils/units';
import { PrimaryButton, Segmented, StatCell, WindRibbon } from '../components';
import { RideMap } from '../components/RideMap';
import { WindHud } from '../components/WindHud';
import { routeToRibbon } from '../routeGeo';
import { useWakeLock } from '../useWakeLock';

const DevReplayPanel = lazy(() => import('../components/DevReplayPanel'));

type RideStatus = 'idle' | 'riding' | 'paused' | 'ended';

/**
 * Ride screen (WR-016): the saddle UI — wind-coloured map, next-turn card, wind HUD, and a glance
 * zone of huge honest numbers. Wires the FixSource (live GPS or the replay dev panel) through the
 * RideController, holds a wake lock while riding, and offers a battery-saver mode.
 */
export function RideScreen() {
  const scored = useResultsStore((s) => s.ranked.find((r) => r.candidate.id === s.selectedId));

  const [status, setStatus] = useState<RideStatus>('idle');
  const [rideState, setRideState] = useState<RideState | null>(null);
  const [cueMode, setCueMode] = useState<CueMode>('voice');
  const [batterySaver, setBatterySaver] = useState(false);

  const controllerRef = useRef<RideController | null>(null);
  const recorderRef = useRef<RideRecorder>(nullRecorder);
  const sourceRef = useRef<GeolocationSource | null>(null);

  useWakeLock(status === 'riding');

  const ribbon = useMemo(() => (scored ? routeToRibbon(scored) : []), [scored]);
  const progressFraction =
    rideState && scored ? Math.min(1, rideState.progressM / (scored.candidate.distanceM || 1)) : 0;

  const handleFix = useCallback((fix: Fix) => {
    const controller = controllerRef.current;
    if (!controller) return;
    recorderRef.current.addFix(fix);
    setRideState(controller.onFix(fix));
  }, []);

  const start = useCallback(() => {
    if (!scored) return;
    const announcer = armAudio(cueMode); // unlock audio on this user gesture
    controllerRef.current = new RideController({ analysis: scored.analysis, announcer });
    recorderRef.current = nullRecorder; // WR-017 swaps in the crash-safe recorder
    recorderRef.current.start();
    setStatus('riding');
    // Live GPS; the dev replay panel can also drive handleFix.
    const source = new GeolocationSource();
    sourceRef.current = source;
    source.start(handleFix);
  }, [scored, cueMode, handleFix]);

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

  const end = useCallback(() => {
    sourceRef.current?.stop();
    controllerRef.current?.pause();
    void recorderRef.current.finish();
    setStatus('ended');
  }, []);

  if (!scored) {
    return (
      <div className="wr-ride wr-ride--empty">
        <p className="wr-muted">Pick a route on the Results screen, then start your ride.</p>
        <a className="wr-navlink" href="#/results">
          ← Results
        </a>
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
        {rideState?.offRoute === 'alert' ? (
          <div className="wr-ride__alert" role="alert">
            Off route — head back to the track
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
          style={{ left: `${progressFraction * 100}%` }}
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

      {import.meta.env.DEV ? (
        <Suspense fallback={null}>
          <DevReplayPanel onFix={handleFix} />
        </Suspense>
      ) : null}
    </div>
  );
}
