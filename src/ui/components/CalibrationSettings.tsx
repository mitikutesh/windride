import { useMemo } from 'react';
import { computeProposal, ENOUGH_RIDES, useCalibrationStore } from '../../state/calibrationStore';
import { PrimaryButton } from './PrimaryButton';

/**
 * Speed-model calibration panel (WR-024). Shows how many rides are banked, the recent ETA error,
 * and — once enough rides are in — a proposed calibrated model with its before/after ETA error.
 * Applying is an explicit owner action; planning never swaps models silently (acceptance).
 */
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function CalibrationSettings() {
  const rideCount = useCalibrationStore((s) => s.rideCount);
  const buckets = useCalibrationStore((s) => s.buckets);
  const applied = useCalibrationStore((s) => s.applied);
  const etaErrors = useCalibrationStore((s) => s.etaErrors);
  const apply = useCalibrationStore((s) => s.apply);
  const clearApplied = useCalibrationStore((s) => s.clearApplied);
  const resetData = useCalibrationStore((s) => s.resetData);

  // Recompute the fit whenever the banked rides change (buckets is a fresh array on every merge).
  const proposal = useMemo(() => computeProposal(buckets, rideCount), [buckets, rideCount]);
  const recentN = Math.min(5, etaErrors.length);
  const recentError = recentN ? mean(etaErrors.slice(-recentN)) : null;

  return (
    <div className="wr-calibration">
      <p className="wr-muted">
        WindRide learns your speed model from finished rides. {rideCount} of {ENOUGH_RIDES} rides
        recorded.{applied ? ' Calibrated model active ✓' : ' Using the default model.'}
      </p>
      {recentError !== null ? (
        <p className="wr-muted">
          Recent ETA error {recentError.toFixed(0)}% (moving time, last {recentN} rides).
        </p>
      ) : null}

      {proposal ? (
        <div className="wr-calibration__proposal">
          <p>
            Calibrated model from {rideCount} rides — ETA error {proposal.beforeErrorPct.toFixed(0)}
            % → {proposal.afterErrorPct.toFixed(0)}%.
          </p>
          <ul className="wr-muted">
            <li>Road base {proposal.result.model.v0Paved.toFixed(1)} km/h</li>
            <li>Gravel base {proposal.result.model.v0Gravel.toFixed(1)} km/h</li>
            <li>Tailwind gain {proposal.result.model.kTail.toFixed(2)}</li>
            <li>Headwind loss {proposal.result.model.kHead.toFixed(2)}</li>
          </ul>
          {proposal.result.fitted.length === 0 ? (
            <p className="wr-muted">
              Not enough varied data to fit any parameter yet — keeping the defaults.
            </p>
          ) : proposal.result.fitted.length < 4 ? (
            <p className="wr-muted">
              Partial fit — only {proposal.result.fitted.join(', ')} had enough data; the rest keep
              their defaults.
            </p>
          ) : null}
          <PrimaryButton onClick={() => apply(proposal.result.model)}>
            Apply calibrated model
          </PrimaryButton>
        </div>
      ) : (
        <p className="wr-muted">
          Record {Math.max(0, ENOUGH_RIDES - rideCount)} more ride(s) to unlock calibration.
        </p>
      )}

      {applied ? (
        <button type="button" className="wr-navlink" onClick={clearApplied}>
          Reset to default model
        </button>
      ) : null}
      {rideCount > 0 ? (
        <button type="button" className="wr-navlink" onClick={resetData}>
          Clear calibration data
        </button>
      ) : null}
    </div>
  );
}
