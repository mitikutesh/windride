import { useEffect } from 'react';
import { ConditionsStrip, DistanceSlider, PrimaryButton, Segmented, Toggle } from '../components';
import { DEFAULT_START, usePlanStore } from '../../state/planStore';

/** Plan screen (WR-008): inputs -> "Find today's route" -> pipeline (mocks or live per env). */
export function PlanScreen() {
  const inputs = usePlanStore((s) => s.inputs);
  const conditions = usePlanStore((s) => s.conditions);
  const status = usePlanStore((s) => s.status);
  const progress = usePlanStore((s) => s.progress);
  const error = usePlanStore((s) => s.error);
  const setInput = usePlanStore((s) => s.setInput);
  const generate = usePlanStore((s) => s.generate);

  // After idb hydration: geolocate ONLY if the start is still the default (never clobber a
  // persisted/manual start), then load the conditions strip.
  useEffect(() => {
    const run = () => {
      const s = usePlanStore.getState();
      const atDefault =
        s.inputs.start.lat === DEFAULT_START.lat && s.inputs.start.lon === DEFAULT_START.lon;
      const located = atDefault ? s.locate() : Promise.resolve();
      void located.then(() => usePlanStore.getState().loadConditions());
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
      <ConditionsStrip conditions={conditions} />

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
      </div>

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
        {status === 'loading' ? progress || 'Working…' : "Find today's route"}
      </PrimaryButton>

      {status === 'error' && error ? (
        <p className="wr-plan__error" role="alert">
          {error.message}
        </p>
      ) : null}
    </section>
  );
}
