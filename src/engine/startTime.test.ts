import { describe, expect, it } from 'vitest';
import type { CandidateRoute, Segment, WindSample } from '../domain';
import {
  scoreMatrix,
  type StartTimeMatrix,
  type CandidateWindInput,
  type ScoreOptions,
} from './scoring';
import { bestStart, startTimeMessage } from './startTime';

function candidate(id: string, bearingDeg: number, n = 10): CandidateRoute {
  const seg: Segment = {
    a: { lat: 60, lon: 24 },
    b: { lat: 60, lon: 24 },
    lengthM: 1000,
    bearingDeg,
    gradePct: 0,
    surface: 'paved',
    exposure: 1,
  };
  return {
    id,
    polyline: [
      { lat: 60, lon: 24 },
      { lat: 60.1, lon: 24.1 },
    ],
    segments: Array.from({ length: n }, () => ({ ...seg })),
    distanceM: n * 1000,
    ascentM: 0,
    steps: [],
  };
}

/** One hourly wind column (shared by every segment); windFromDeg rotates hour by hour. */
function rotatingWind(hourlyFrom: number[]): WindSample[] {
  return hourlyFrom.map((from, h) => ({
    windMs: 8,
    windFromDeg: from,
    gustMs: 12,
    precipProb: 0,
    tempC: 15,
    time: `2026-01-01T${String(8 + h).padStart(2, '0')}:00`,
  }));
}
function input(c: CandidateRoute, hourlyFrom: number[]): CandidateWindInput {
  const col = rotatingWind(hourlyFrom);
  return { candidate: c, windBySegment: c.segments.map(() => col) };
}

const HOURS = [0, 1, 2, 3, 4, 5];
const OPTS: ScoreOptions = { targetDistanceM: 10_000 };

describe('scoreMatrix', () => {
  it('the best departure hour tracks the wind: tailwind late ⇒ late best', () => {
    // bearing 45: windFrom 225 is a tailwind. Headwind for h0-2, tailwind for h3-5.
    const m = scoreMatrix([input(candidate('A', 45), [45, 45, 45, 225, 225, 225])], HOURS, OPTS);
    expect(bestStart(m)!.hourIndex).toBe(3); // first tailwind hour
  });

  it('...and moves earlier when the wind rotates earlier', () => {
    const m = scoreMatrix([input(candidate('A', 45), [225, 225, 225, 45, 45, 45])], HOURS, OPTS);
    expect(bestStart(m)!.hourIndex).toBe(0); // tailwind is now at the start
  });

  it('daylight constraint rejects late departure cells (nulls)', () => {
    const m = scoreMatrix([input(candidate('A', 45), [225, 225, 225, 225, 225, 225])], HOURS, {
      ...OPTS,
      homeBeforeDark: true,
      minutesUntilSunset: 200, // shrinks 60/hour; a ~33 min ride can't finish from h3 on
    });
    const cells = m.rows[0].cells;
    expect(cells.slice(0, 3).every((c) => c.total !== null)).toBe(true);
    expect(cells.slice(3).every((c) => c.total === null)).toBe(true);
  });
});

describe('bestStart + startTimeMessage', () => {
  const matrix: StartTimeMatrix = {
    hours: [0, 3],
    rows: [
      {
        candidate: candidate('A', 45),
        cells: [
          { hourIndex: 0, total: 60 },
          { hourIndex: 3, total: 58 },
        ],
      },
      {
        candidate: candidate('B', 225),
        cells: [
          { hourIndex: 0, total: 40 },
          { hourIndex: 3, total: 72 },
        ],
      },
    ],
  };
  const label = (id: string) => `Route ${id}`;
  const hourLabel = (h: number) => `${String(17 + h).padStart(2, '0')}:00`;

  it('bestStart picks the joint max cell', () => {
    expect(bestStart(matrix)).toMatchObject({ candidateId: 'B', hourIndex: 3, total: 72 });
  });

  it('bestStart honours allowedHours (restricting the window)', () => {
    expect(bestStart(matrix, [0])).toMatchObject({ candidateId: 'A', hourIndex: 0, total: 60 });
  });

  it('ignores a fully-rejected candidate row', () => {
    const withDeadRow: StartTimeMatrix = {
      hours: [0, 3],
      rows: [
        ...matrix.rows,
        {
          candidate: candidate('C', 135),
          cells: [
            { hourIndex: 0, total: null },
            { hourIndex: 3, total: null },
          ],
        },
      ],
    };
    expect(bestStart(withDeadRow)).toMatchObject({ candidateId: 'B', hourIndex: 3 });
    // C contributes nothing, so the runner-up is still A.
    expect(startTimeMessage(withDeadRow, { label, hourLabel })).toBe(
      'Route B at 20:00 beats Route A at any time in your window.',
    );
  });

  it('phrases a cross-route win ("Route B at 20:00 beats Route A ...")', () => {
    expect(startTimeMessage(matrix, { label, hourLabel })).toBe(
      'Route B at 20:00 beats Route A at any time in your window.',
    );
  });

  it('falls back to a plain best-window line when nothing else is close', () => {
    const solo: StartTimeMatrix = {
      hours: [0],
      rows: [{ candidate: candidate('A', 45), cells: [{ hourIndex: 0, total: 60 }] }],
    };
    expect(startTimeMessage(solo, { label, hourLabel })).toBe(
      'Route A at 17:00 is your best window.',
    );
  });

  it('reports when nothing fits before dark', () => {
    const dark: StartTimeMatrix = {
      hours: [0],
      rows: [{ candidate: candidate('A', 45), cells: [{ hourIndex: 0, total: null }] }],
    };
    expect(startTimeMessage(dark, { label, hourLabel })).toBe(
      'No ride fits before dark in your window.',
    );
  });
});
