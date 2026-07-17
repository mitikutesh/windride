import type { WinterInfo } from '../../state/plan/runPlan';

/**
 * Winter-mode advisory (WR-027). Shows the ice-risk caution — always hedged, never a guarantee —
 * plus the coldest temperature and precipitation type (snow ≠ rain). The ice line is an alert; the
 * plain winter note is not, to avoid alert spam. Renders nothing outside winter mode.
 */
const PRECIP_WORD: Record<WinterInfo['precip'], string | null> = {
  none: null,
  snow: 'Snow likely',
  sleet: 'Sleet likely',
  rain: 'Rain likely',
};

export function WinterCaution({ winter }: { winter: WinterInfo | null }) {
  if (!winter) return null;
  const precip = PRECIP_WORD[winter.precip];
  return (
    <div className="wr-winter">
      {winter.iceRisk ? (
        <p className="wr-winter__ice" role="alert">
          <span aria-hidden="true">❄ </span>
          {winter.message}
        </p>
      ) : null}
      <p className="wr-muted">
        Winter mode · coldest {Math.round(winter.minTempC)} °C{precip ? ` · ${precip}` : ''}
      </p>
    </div>
  );
}
