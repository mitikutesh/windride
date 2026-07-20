import { useEffect } from 'react';
import { ConditionsStrip, DistanceSlider, PrimaryButton, Segmented, Toggle } from '../components';
import { DiscoverRoutesButton } from '../components/DiscoverRoutesButton';
import { DownwindResults } from '../components/DownwindResults';
import { MissingKeyBanner } from '../components/MissingKeyBanner';
import { NlPlanBox } from '../components/NlPlanBox';
import { suggestWinter } from '../../engine/winter';
import { useKeychainStore } from '../../state/keychainStore';
import { DEFAULT_START, usePlanStore } from '../../state/planStore';
import { useNoveltyStore } from '../../state/noveltyStore';
import { useSavedRoutesStore } from '../../state/savedRoutesStore';
import { downloadText } from '../download';
import { gpxFilename, toGpx } from '../../utils/gpx';
import { localYMD } from '../../utils/units';

/** Plan screen (WR-008): inputs -> "Find today's route" -> pipeline (mocks or live per env). */
export function PlanScreen() {
  const inputs = usePlanStore((s) => s.inputs);
  const conditions = usePlanStore((s) => s.conditions);
  const status = usePlanStore((s) => s.status);
  const progress = usePlanStore((s) => s.progress);
  const error = usePlanStore((s) => s.error);
  const setInput = usePlanStore((s) => s.setInput);
  const generate = usePlanStore((s) => s.generate);
  const downwind = usePlanStore((s) => s.downwind);
  // NL planning is opt-in: shown only when the user has picked an AI provider AND set its key.
  const aiReady = useKeychainStore((s) => Boolean(s.aiProvider && s.keys.ai));
  const savedRoutes = useSavedRoutesStore((s) => s.routes);
  const removeRoute = useSavedRoutesStore((s) => s.remove);

  // After idb hydration: geolocate ONLY if the start is still the default (never clobber a
  // persisted/manual start), then load the conditions strip.
  useEffect(() => {
    const run = () => {
      const s = usePlanStore.getState();
      const atDefault =
        s.inputs.start.lat === DEFAULT_START.lat && s.inputs.start.lon === DEFAULT_START.lon;
      const located = atDefault ? s.locate() : Promise.resolve();
      void located.then(() => usePlanStore.getState().loadConditions());
      void useSavedRoutesStore.getState().refresh();
      void useNoveltyStore.getState().hydrate(); // ridden roads for the Novelty sub-score (WR-028)
    };
    if (usePlanStore.persist.hasHydrated()) {
      run();
      return;
    }
    return usePlanStore.persist.onFinishHydration(run);
  }, []);

  const setStartCoord = (axis: 'lat' | 'lon', raw: string) => {
    if (raw === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const limit = axis === 'lat' ? 90 : 180;
    if (Math.abs(n) > limit) return;
    setInput({ start: { ...inputs.start, [axis]: n } });
  };

  const busy = status === 'loading' || status === 'locating';

  return (
    <section className="wr-screen wr-plan">
      <h1>Plan a ride</h1>
      <MissingKeyBanner />
      <ConditionsStrip conditions={conditions} />

      {aiReady ? <NlPlanBox /> : null}

      <DistanceSlider value={inputs.distanceKm} onChange={(km) => setInput({ distanceKm: km })} />

      <div className="wr-field">
        <span className="wr-field__label">Shape</span>
        <Segmented
          ariaLabel="Route shape"
          value={inputs.routeType}
          onChange={(routeType) => setInput({ routeType })}
          options={[
            { value: 'loop', label: 'Loop' },
            { value: 'out-and-back', label: 'Out & back' },
            { value: 'downwind', label: 'Downwind' },
          ]}
        />
      </div>

      <div className="wr-field">
        <span className="wr-field__label">Surface</span>
        <Segmented
          ariaLabel="Surface"
          value={inputs.surface}
          onChange={(surface) => setInput({ surface })}
          options={[
            { value: 'road', label: 'Road' },
            { value: 'gravel', label: 'Gravel' },
          ]}
        />
      </div>

      <div className="wr-field">
        <span className="wr-field__label">Start</span>
        <Segmented
          ariaLabel="Departure time"
          value={String(inputs.departureHour ?? 0)}
          onChange={(v) => setInput({ departureHour: Number(v) })}
          options={[
            { value: '0', label: 'Now' },
            { value: '3', label: '+3 h' },
            { value: '6', label: '+6 h' },
          ]}
        />
      </div>

      <div className="wr-field wr-plan__toggles">
        <Toggle
          checked={false}
          onChange={() => {}}
          label="Shelter me"
          disabled
          title="Shelter-aware routing arrives in v0.3 (Epic 3)"
        />
        <Toggle
          checked={inputs.homeBeforeDark}
          onChange={(homeBeforeDark) => setInput({ homeBeforeDark })}
          label="Home before dark"
        />
        <Toggle
          checked={inputs.avoidBusy}
          onChange={(avoidBusy) => setInput({ avoidBusy })}
          label="Avoid busy roads"
        />
        <Toggle
          checked={!!inputs.winter}
          onChange={(winter) => setInput({ winter })}
          label="Winter mode"
          title="Studded-tyre speeds, home-before-dark on, ice-risk cautions (WR-027)"
        />
      </div>
      {conditions && !inputs.winter && suggestWinter(conditions.tempC) ? (
        <p className="wr-muted" role="note">
          It’s {Math.round(conditions.tempC)} °C — consider Winter mode for honest ice-aware ETAs.
        </p>
      ) : null}

      <details className="wr-plan__start">
        <summary>
          Start: {inputs.start.lat.toFixed(4)}, {inputs.start.lon.toFixed(4)}
        </summary>
        <div className="wr-field__row">
          <label className="wr-field__label">
            Lat
            <input
              type="number"
              step="0.0001"
              value={inputs.start.lat}
              onChange={(e) => setStartCoord('lat', e.target.value)}
            />
          </label>
          <label className="wr-field__label">
            Lon
            <input
              type="number"
              step="0.0001"
              value={inputs.start.lon}
              onChange={(e) => setStartCoord('lon', e.target.value)}
            />
          </label>
        </div>
      </details>

      <PrimaryButton onClick={() => void generate()} disabled={busy}>
        {status === 'loading'
          ? progress || 'Working…'
          : inputs.routeType === 'downwind'
            ? 'Find downwind rides'
            : "Find today's route"}
      </PrimaryButton>

      {aiReady && inputs.routeType !== 'downwind' ? <DiscoverRoutesButton /> : null}

      {status === 'error' && error ? (
        <p className="wr-plan__error" role="alert">
          {error.message}
        </p>
      ) : null}

      {inputs.routeType === 'downwind' ? <DownwindResults results={downwind} /> : null}

      {savedRoutes.length > 0 ? (
        <section className="wr-plan__saved" aria-label="Saved routes">
          <h2>Saved routes</h2>
          <ul className="wr-saved-list">
            {savedRoutes.map((r) => (
              <li key={r.id} className="wr-saved-list__item">
                <span>
                  {r.name} · <span className="tabular">{r.distanceKm.toFixed(1)} km</span>
                </span>
                <span className="wr-saved-list__actions">
                  <button
                    type="button"
                    className="wr-navlink"
                    onClick={() =>
                      downloadText(
                        gpxFilename(r.distanceKm, localYMD(new Date(r.savedAt))),
                        'application/gpx+xml',
                        toGpx(r.track),
                      )
                    }
                  >
                    Export
                  </button>
                  <button
                    type="button"
                    className="wr-navlink"
                    onClick={() => void removeRoute(r.id)}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
