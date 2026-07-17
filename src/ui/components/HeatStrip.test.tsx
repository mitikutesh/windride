import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { HeatStrip, type HeatCell } from './HeatStrip';
import { heatBucket } from './heat';

describe('heatBucket', () => {
  it('maps scores to 0..4 buckets across the range', () => {
    expect(heatBucket(0, 0, 100)).toBe(0);
    expect(heatBucket(100, 0, 100)).toBe(4);
    expect(heatBucket(50, 0, 100)).toBe(2);
    expect(heatBucket(42, 42, 42)).toBe(2); // degenerate range → middle
  });
});

describe('<HeatStrip />', () => {
  const cells: HeatCell[] = [
    { hourIndex: 0, total: 10 }, // 0.1 of range → bucket 0
    { hourIndex: 1, total: 80 }, // 0.8 of range → bucket 4
    { hourIndex: 2, total: null }, // ruled out (dark)
  ];

  it('colours cells by bucket, marks best + now, and renders off cells', () => {
    const { container } = render(
      <HeatStrip
        cells={cells}
        min={0}
        max={100}
        bestHourIndex={1}
        nowHourIndex={0}
        hourLabel={(h) => `${h}:00`}
      />,
    );
    const nodes = container.querySelectorAll('.wr-heat__cell');
    expect(nodes).toHaveLength(3);
    expect(nodes[0].className).toContain('wr-heat__cell--b0'); // low score
    expect(nodes[0].className).toContain('is-now');
    expect(nodes[1].className).toContain('wr-heat__cell--b4'); // high score
    expect(nodes[1].className).toContain('is-best');
    expect(nodes[2].className).toContain('wr-heat__cell--off'); // null cell
  });
});
