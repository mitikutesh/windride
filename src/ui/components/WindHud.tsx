import type { CurrentWind } from '../../nav/rideController';
import type { WindTransition } from '../../nav/windHud';
import { metresToKm } from '../../utils/units';
import { windColor } from '../windColors';

interface WindHudProps {
  wind: CurrentWind | null;
  headingDeg: number | null;
  transition: WindTransition | null;
}

const KIND_WORD: Record<CurrentWind['kind'], string> = {
  tail: 'Tailwind',
  cross: 'Crosswind',
  head: 'Headwind',
};

/**
 * Wind HUD (WR-016, NAVIGATION_SPEC §5): an arrow showing where the wind blows relative to the
 * rider's heading, plus the signature next-transition line ("Tailwind in 2.3 km").
 */
export function WindHud({ wind, headingDeg, transition }: WindHudProps) {
  // Arrow points where the wind blows TO, relative to travel: 0° = pushing the rider forward.
  const rotation = wind ? wind.windToDeg - (headingDeg ?? 0) : 0;
  const transitionText = transition
    ? `${KIND_WORD[transition.kind]} in ${metresToKm(transition.inM, transition.inM < 1000 ? 2 : 1)} km`
    : 'Steady wind ahead';

  return (
    <div className="wr-windhud" aria-label="Wind">
      <svg
        className="wr-windhud__arrow"
        viewBox="0 0 24 24"
        width={40}
        height={40}
        aria-hidden="true"
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <path d="M12 2 L18 20 L12 16 L6 20 Z" fill={wind ? windColor(wind.kind) : 'currentColor'} />
      </svg>
      <div className="wr-windhud__text">
        <span className="wr-windhud__now">{wind ? KIND_WORD[wind.kind] : '—'}</span>
        <span className="wr-windhud__next">{transitionText}</span>
      </div>
    </div>
  );
}
