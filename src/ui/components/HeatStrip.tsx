import { HEAT_BUCKETS, heatBucket } from './heat';

export interface HeatCell {
  hourIndex: number;
  /** Score 0–100, or null when that departure hour is ruled out (e.g. after dark). */
  total: number | null;
}

interface HeatStripProps {
  cells: HeatCell[];
  min: number;
  max: number;
  bestHourIndex?: number;
  nowHourIndex?: number;
  hourLabel: (hourIndex: number) => string;
  ariaLabel?: string;
}

/**
 * Per-route heat strip (WR-020, DESIGN §4): one cell per departure hour, coloured by score bucket,
 * with the best cell marked and a "now" marker. Rejected hours render as an "off" cell.
 */
export function HeatStrip({
  cells,
  min,
  max,
  bestHourIndex,
  nowHourIndex,
  hourLabel,
  ariaLabel = 'Score by departure hour',
}: HeatStripProps) {
  return (
    <div className="wr-heat" role="img" aria-label={ariaLabel}>
      {cells.map((c) => {
        const off = c.total === null;
        const bucket = off ? -1 : heatBucket(c.total as number, min, max);
        const classes = [
          'wr-heat__cell',
          off ? 'wr-heat__cell--off' : `wr-heat__cell--b${bucket}`,
          c.hourIndex === bestHourIndex ? 'is-best' : '',
          c.hourIndex === nowHourIndex ? 'is-now' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const title = off
          ? `${hourLabel(c.hourIndex)}: unavailable`
          : `${hourLabel(c.hourIndex)}: ${Math.round(c.total as number)}`;
        return <span key={c.hourIndex} className={classes} title={title} aria-label={title} />;
      })}
      <span className="wr-visually-hidden">{`${HEAT_BUCKETS}-level score by hour`}</span>
    </div>
  );
}
