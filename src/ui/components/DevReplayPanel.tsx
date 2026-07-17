import { useEffect, useRef, useState } from 'react';
import cleanLoop from '../../../fixtures/traces/clean-loop.gpx?raw';
import figureEight from '../../../fixtures/traces/figure-eight.gpx?raw';
import offRoute from '../../../fixtures/traces/off-route.gpx?raw';
import type { Fix } from '../../nav/fixSource';
import { parseTraceToFixes, ReplaySource } from '../../nav/replay';
import { PrimaryButton } from './PrimaryButton';
import { Segmented } from './Segmented';

const TRACES = {
  'clean-loop': cleanLoop,
  'off-route': offRoute,
  'figure-eight': figureEight,
} as const;
type TraceName = keyof typeof TRACES;

/**
 * Dev-only replay panel (WR-012): pick a synthetic trace, set speed, start/stop — streams fixes
 * through the real ReplaySource so navigation can be exercised at the desk. Lazy-loaded only in
 * dev builds (see KitScreen), so its bundled traces never ship to production.
 */
interface DevReplayPanelProps {
  /** When set, each replayed fix is forwarded here (WR-016: drive the Ride screen from replay). */
  onFix?: (fix: Fix) => void;
}

export default function DevReplayPanel({ onFix }: DevReplayPanelProps = {}) {
  const [trace, setTrace] = useState<TraceName>('clean-loop');
  const [speed, setSpeed] = useState(10);
  const [fix, setFix] = useState<Fix | null>(null);
  const [count, setCount] = useState(0);
  const [running, setRunning] = useState(false);
  const sourceRef = useRef<ReplaySource | null>(null);

  // Stop the replay if the panel unmounts mid-stream (otherwise timers fire on a dead component).
  useEffect(() => () => sourceRef.current?.stop(), []);

  const start = () => {
    sourceRef.current?.stop();
    const fixes = parseTraceToFixes(TRACES[trace]);
    let n = 0;
    const source = new ReplaySource(fixes, { speed });
    sourceRef.current = source;
    setRunning(true);
    setCount(0);
    source.start((f) => {
      n += 1;
      setFix(f);
      setCount(n);
      onFix?.(f);
      if (n === fixes.length) setRunning(false);
    });
  };
  const stop = () => {
    sourceRef.current?.stop();
    setRunning(false);
  };

  return (
    <section className="wr-devpanel" aria-label="Replay dev panel">
      <h2>Replay (dev)</h2>
      <Segmented
        ariaLabel="Trace"
        value={trace}
        onChange={(t) => setTrace(t)}
        options={[
          { value: 'clean-loop', label: 'Clean loop' },
          { value: 'off-route', label: 'Off-route' },
          { value: 'figure-eight', label: 'Figure-8' },
        ]}
      />
      <label className="wr-field__label">
        Speed ×<span className="tabular"> {speed}</span>
        <input
          type="range"
          className="wr-slider"
          min={1}
          max={20}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        />
      </label>
      <div className="wr-kit__row">
        <PrimaryButton onClick={start} disabled={running}>
          Start
        </PrimaryButton>
        <button type="button" className="wr-navlink" onClick={stop}>
          Stop
        </button>
      </div>
      {fix ? (
        <p className="wr-muted tabular">
          fix {count}: {fix.lat.toFixed(5)}, {fix.lon.toFixed(5)} ·{' '}
          {((fix.speed ?? 0) * 3.6).toFixed(1)} km/h
        </p>
      ) : null}
    </section>
  );
}
