import { useState } from 'react';
import { BASEMAPS, type BasemapId } from '../basemaps';

interface BasemapSwitcherProps {
  value: BasemapId;
  onChange: (id: BasemapId) => void;
}

/**
 * Basemap picker overlaid on the maps (DEC-035, collapsed in DEC-055): one round layers button;
 * tapping it reveals the Streets/Cycling/Satellite/Terrain options and picking one collapses it
 * again — the map stays uncluttered while riding. Presentational + WebGL-free so it's
 * unit-testable on its own — the map components own the MapLibre wiring.
 */
export function BasemapSwitcher({ value, onChange }: BasemapSwitcherProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="wr-map__layers" role="group" aria-label="Base map">
      <button
        type="button"
        className="wr-mapbtn"
        aria-expanded={open}
        aria-label="Base map layers"
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true">
          <path d="M12 3 L21 8.2 L12 13.4 L3 8.2 Z" fill="currentColor" />
          <path
            d="M4.4 12.4 L12 16.8 L19.6 12.4 M4.4 16 L12 20.4 L19.6 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open
        ? BASEMAPS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`wr-map__layer${b.id === value ? ' is-active' : ''}`}
              aria-pressed={b.id === value}
              onClick={() => {
                onChange(b.id);
                setOpen(false);
              }}
            >
              {b.label}
            </button>
          ))
        : null}
    </div>
  );
}
