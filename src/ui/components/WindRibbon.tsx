import { layoutRibbon, type RibbonSegment, type WindKind } from './ribbon';

const COORD = 1000; // internal coordinate space; the SVG scales to its container width.

const KIND_WORD: Record<WindKind, string> = {
  tail: 'tailwind',
  cross: 'crosswind',
  head: 'headwind',
  shelter: 'sheltered',
};

interface WindRibbonProps {
  segments: RibbonSegment[];
  height?: number;
  /** Override the auto-generated accessible description. */
  ariaLabel?: string;
}

/** Segmented wind story bar (DESIGN §4). Pure: props in, SVG out. Colour = wind relationship. */
export function WindRibbon({ segments, height = 12, ariaLabel }: WindRibbonProps) {
  const laid = layoutRibbon(segments, COORD);
  const label =
    ariaLabel ??
    (laid.length > 0
      ? `Wind mix: ${laid
          .map((s) => `${Math.round(s.fraction * 100)}% ${KIND_WORD[s.kind]}`)
          .join(', ')}`
      : 'No wind data');

  return (
    <svg
      className="wr-ribbon"
      width="100%"
      height={height}
      viewBox={`0 0 ${COORD} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {laid.length === 0 ? (
        <rect x={0} y={0} width={COORD} height={height} className="wr-ribbon__empty" />
      ) : (
        laid.map((s, i) => (
          <rect
            key={i}
            x={s.x}
            y={0}
            width={s.width}
            height={height}
            className={`wr-ribbon__seg wr-ribbon__seg--${s.kind}`}
          />
        ))
      )}
    </svg>
  );
}
