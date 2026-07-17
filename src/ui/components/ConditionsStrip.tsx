import type { Conditions } from '../../state/plan/runPlan';
import { compass8, timeOfDay, windArrowRotationDeg } from '../../utils/units';
import { StatCell } from './StatCell';

/**
 * Current conditions row (WR-008). The wind arrow points where the wind BLOWS TO (users read
 * arrows as flow); the text says "from SW" — both from wind_from (DESIGN §1 / WR-008 note).
 */
export function ConditionsStrip({ conditions }: { conditions: Conditions | null }) {
  if (!conditions) {
    return <div className="wr-conditions wr-muted">Loading conditions…</div>;
  }
  const { windMs, windFromDeg, tempC, precipProb, sunset } = conditions;
  const from = compass8(windFromDeg);
  return (
    <div className="wr-conditions" role="group" aria-label="Current conditions">
      <div
        className="wr-conditions__wind"
        aria-label={`Wind ${windMs.toFixed(0)} metres per second from ${from}`}
      >
        <svg
          className="wr-windarrow"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          style={{ transform: `rotate(${windArrowRotationDeg(windFromDeg)}deg)` }}
          aria-hidden="true"
        >
          <path className="wr-windarrow__glyph" d="M12 2 L18 20 L12 16 L6 20 Z" />
        </svg>
        <div>
          <div className="wr-stat__value tabular">
            {windMs.toFixed(0)}
            <span className="wr-stat__unit"> m/s</span>
          </div>
          <div className="wr-stat__label">from {from}</div>
        </div>
      </div>
      <StatCell label="Temp" value={tempC.toFixed(0)} unit="°C" />
      <StatCell label="Rain" value={precipProb} unit="%" />
      <StatCell label="Sunset" value={timeOfDay(sunset)} />
    </div>
  );
}
