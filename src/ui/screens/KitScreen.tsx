import { lazy, Suspense, useState } from 'react';
import {
  Chip,
  PrimaryButton,
  ScoreRing,
  StatCell,
  Toggle,
  WindRibbon,
  type RibbonSegment,
} from '../components';
import { StravaSettings } from '../components/StravaSettings';

// Dev-only replay panel (WR-012). The conditional dynamic import is dead-code-eliminated from
// production builds (import.meta.env.DEV is statically false), so its bundled traces never ship.
const DevReplayPanel = import.meta.env.DEV
  ? lazy(() => import('../components/DevReplayPanel'))
  : null;

const RIBBON: RibbonSegment[] = [
  { fraction: 0.45, kind: 'tail' },
  { fraction: 0.2, kind: 'cross' },
  { fraction: 0.25, kind: 'head' },
  { fraction: 0.1, kind: 'shelter' },
];

const SURFACES = ['Road', 'Gravel'] as const;

/** Component gallery / demo route (WR-002). Verifies the kit renders and hit targets are >=44px. */
export function KitScreen() {
  const [dark, setDark] = useState(true);
  const [surface, setSurface] = useState<(typeof SURFACES)[number]>('Road');

  return (
    <section className="wr-screen wr-kit">
      <h1>Component kit</h1>
      <p className="wr-muted">
        Every colour is a semantic wind token (DESIGN §1). Hit targets are &gt;= 44 px; motion is
        disabled under <code>prefers-reduced-motion</code>.
      </p>

      <h2>WindRibbon</h2>
      <WindRibbon segments={RIBBON} height={14} />

      <h2>ScoreRing</h2>
      <div className="wr-kit__row">
        <ScoreRing score={0} />
        <ScoreRing score={50} />
        <ScoreRing score={100} />
        <ScoreRing score={72} />
      </div>

      <h2>StatCell</h2>
      <div className="wr-kit__row">
        <StatCell label="Distance" value={51.8} unit="km" />
        <StatCell label="Wind ETA" value="2:14" unit="h:mm" />
        <StatCell label="Ascent" value={382} unit="m" />
      </div>

      <h2>Buttons &amp; chips</h2>
      <div className="wr-kit__row">
        <PrimaryButton>Generate routes</PrimaryButton>
        <PrimaryButton disabled>Disabled</PrimaryButton>
      </div>
      <div className="wr-kit__row">
        {SURFACES.map((s) => (
          <Chip key={s} selected={surface === s} onClick={() => setSurface(s)}>
            {s}
          </Chip>
        ))}
        <Chip>8 m/s SW</Chip>
      </div>

      <h2>Toggle</h2>
      <Toggle checked={dark} onChange={setDark} label="Home before dark" />

      <h2>Strava (upload-only)</h2>
      <StravaSettings />

      {DevReplayPanel ? (
        <Suspense fallback={null}>
          <DevReplayPanel />
        </Suspense>
      ) : null}
    </section>
  );
}
