import { useMemo, useState } from 'react';
import type { FeelsPoint } from '../../engine/feelsProfile';
import { metresToKm } from '../../utils/units';
import { windColor } from '../windColors';

interface FeelsChartProps {
  points: FeelsPoint[];
}

const W = 1000;
const H = 280;
const PAD = 28;

/**
 * Elevation chart (WR-022, PRODUCT_SPEC §5): the actual profile as a filled area, the wind-equivalent
 * "feels-like" profile as a dashed line, a wind-kind strip along the base, and a distance axis. SVG,
 * no chart lib. Tap/drag scrubs a readout; with no pointer, static labels sit at the extremes.
 */
export function FeelsChart({ points }: FeelsChartProps) {
  const [scrub, setScrub] = useState<number | null>(null);

  const geom = useMemo(() => {
    if (points.length < 2) return null;
    const total = points[points.length - 1].distanceM || 1;
    const eles = points.flatMap((p) => [p.eleM, p.feelsEleM]);
    const yMin = Math.min(0, ...eles);
    const yMax = Math.max(0, ...eles);
    const ySpan = yMax - yMin || 1;
    const x = (d: number) => PAD + (d / total) * (W - 2 * PAD);
    const y = (e: number) => H - PAD - ((e - yMin) / ySpan) * (H - 2 * PAD);
    return { total, x, y, baseY: y(0) };
  }, [points]);

  if (!geom) return null;
  const { total, x, y, baseY } = geom;

  const actualArea =
    `M ${x(0)},${baseY} ` +
    points.map((p) => `L ${x(p.distanceM).toFixed(1)},${y(p.eleM).toFixed(1)}`).join(' ') +
    ` L ${x(total)},${baseY} Z`;
  const feelsLine = points
    .map(
      (p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.distanceM).toFixed(1)},${y(p.feelsEleM).toFixed(1)}`,
    )
    .join(' ');

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const d = ((px - PAD) / (W - 2 * PAD)) * total;
    let nearest = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].distanceM - d) < Math.abs(points[nearest].distanceM - d)) nearest = i;
    }
    setScrub(nearest);
  };

  const active = scrub !== null ? points[scrub] : null;
  const KIND_WORD = {
    tail: 'tailwind',
    cross: 'crosswind',
    head: 'headwind',
    shelter: 'sheltered',
  };

  return (
    <figure className="wr-feels">
      <svg
        className="wr-feels__svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Elevation profile with a wind-adjusted feels-like overlay"
        onPointerMove={onMove}
        onPointerLeave={() => setScrub(null)}
      >
        {/* Wind-kind strip along the base. */}
        {points.slice(1).map((p, i) => (
          <rect
            key={i}
            x={x(points[i].distanceM)}
            y={H - PAD}
            width={Math.max(0, x(p.distanceM) - x(points[i].distanceM))}
            height={6}
            fill={windColor(p.kind)}
          />
        ))}
        <path className="wr-feels__actual" d={actualArea} />
        <path className="wr-feels__feels" d={feelsLine} fill="none" />
        {active ? (
          <line
            className="wr-feels__cursor"
            x1={x(active.distanceM)}
            y1={PAD}
            x2={x(active.distanceM)}
            y2={H - PAD}
          />
        ) : null}
      </svg>

      <figcaption className="wr-feels__readout tabular">
        {active ? (
          <>
            {metresToKm(active.distanceM)} km · {Math.round(active.eleM)} m · feels{' '}
            {active.feelsGradePct >= 0 ? '+' : ''}
            {active.feelsGradePct.toFixed(1)}% · {KIND_WORD[active.kind]}
          </>
        ) : (
          // No-pointer / reduced-motion fallback: static extremes.
          <>
            0–{metresToKm(total)} km · climb {Math.round(Math.max(...points.map((p) => p.eleM)))} m
            · feels-like dashed
          </>
        )}
      </figcaption>
    </figure>
  );
}
