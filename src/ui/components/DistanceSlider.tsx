import { useId } from 'react';

interface DistanceSliderProps {
  value: number;
  onChange: (km: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

/** Distance range input (DESIGN §4). Value is echoed in the label for glove-free confirmation. */
export function DistanceSlider({
  value,
  onChange,
  min = 20,
  max = 100,
  step = 5,
}: DistanceSliderProps) {
  const id = useId();
  return (
    <div className="wr-field">
      <label htmlFor={id} className="wr-field__label">
        Distance <span className="tabular">{value} km</span>
      </label>
      <input
        id={id}
        type="range"
        className="wr-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
