import { BASEMAPS, type BasemapId } from '../basemaps';

interface BasemapSwitcherProps {
  value: BasemapId;
  onChange: (id: BasemapId) => void;
}

/**
 * The Streets/Cycling/Satellite/Terrain button group overlaid on the route map (DEC-035).
 * Presentational + WebGL-free so it's unit-testable on its own — RouteMap owns the MapLibre wiring.
 */
export function BasemapSwitcher({ value, onChange }: BasemapSwitcherProps) {
  return (
    <div className="wr-map__layers" role="group" aria-label="Base map">
      {BASEMAPS.map((b) => (
        <button
          key={b.id}
          type="button"
          className={`wr-map__layer${b.id === value ? ' is-active' : ''}`}
          aria-pressed={b.id === value}
          onClick={() => onChange(b.id)}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
