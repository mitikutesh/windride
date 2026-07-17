import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { FeelsPoint } from '../../engine/feelsProfile';
import { FeelsChart } from './FeelsChart';

const points: FeelsPoint[] = [
  { distanceM: 0, eleM: 0, feelsEleM: 0, gradePct: 0, feelsGradePct: 0, kind: 'cross' },
  { distanceM: 1000, eleM: 20, feelsEleM: 45, gradePct: 2, feelsGradePct: 4.5, kind: 'head' },
  { distanceM: 2000, eleM: 10, feelsEleM: -5, gradePct: -1, feelsGradePct: -1.5, kind: 'tail' },
];

describe('<FeelsChart />', () => {
  it('renders the actual area, the dashed feels line, and a wind-kind strip', () => {
    const { container } = render(<FeelsChart points={points} />);
    expect(container.querySelector('.wr-feels__actual')).not.toBeNull();
    expect(container.querySelector('.wr-feels__feels')).not.toBeNull();
    // One wind-kind strip rect per segment interval (points.length - 1).
    expect(container.querySelectorAll('rect')).toHaveLength(points.length - 1);
    // Static fallback readout (no pointer) mentions the distance range.
    expect(container.querySelector('.wr-feels__readout')?.textContent).toMatch(/km/);
  });

  it('renders a distance axis with tick labels', () => {
    const { container } = render(<FeelsChart points={points} />);
    expect(container.querySelector('.wr-feels__axis')).not.toBeNull();
    expect(container.querySelectorAll('.wr-feels__tick').length).toBeGreaterThanOrEqual(3);
  });

  it('scrubbing shows a readout (distance, ele, feels-grade, kind) + cursor', () => {
    const { container } = render(<FeelsChart points={points} />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    // jsdom returns a 0-width rect; stub a real width so the scrub math resolves.
    svg.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 1000,
        height: 280,
        right: 1000,
        bottom: 280,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect;
    // jsdom's PointerEvent drops clientX; a MouseEvent typed 'pointermove' carries it and still
    // fires React's onPointerMove. ~mid-route → the head point at 1000 m.
    fireEvent(svg, new MouseEvent('pointermove', { clientX: 500, bubbles: true }));
    expect(container.querySelector('.wr-feels__readout')?.textContent).toMatch(
      /feels \+4\.5% · headwind/,
    );
    expect(container.querySelector('.wr-feels__cursor')).not.toBeNull();
  });

  it('renders nothing for a degenerate (<2 point) profile', () => {
    const { container } = render(<FeelsChart points={points.slice(0, 1)} />);
    expect(container.querySelector('.wr-feels__svg')).toBeNull();
  });
});
