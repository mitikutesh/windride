import { useId } from 'react';
import { ringGeometry } from './ring';

interface ScoreRingProps {
  /** 0–100; clamped. */
  score: number;
  size?: number;
  stroke?: number;
  /** Override the auto-generated accessible label. */
  label?: string;
}

/** A 0–100 score arc (DESIGN §4). Pure: props in, SVG out. */
export function ScoreRing({ score, size = 96, stroke = 10, label }: ScoreRingProps) {
  const gradientId = useId();
  const g = ringGeometry(score, size, stroke);
  const aria = label ?? `Score ${g.score} out of 100`;

  return (
    <svg
      className="wr-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={aria}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="wr-ring__stop-a" />
          <stop offset="1" className="wr-ring__stop-b" />
        </linearGradient>
      </defs>
      <circle
        className="wr-ring__track"
        cx={g.center}
        cy={g.center}
        r={g.radius}
        strokeWidth={stroke}
        fill="none"
      />
      <circle
        className="wr-ring__value"
        cx={g.center}
        cy={g.center}
        r={g.radius}
        strokeWidth={stroke}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeDasharray={g.dashArray}
        strokeDashoffset={g.dashOffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${g.center} ${g.center})`}
      />
      <text
        className="wr-ring__num tabular"
        x={g.center}
        y={g.center}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {g.score}
      </text>
    </svg>
  );
}
