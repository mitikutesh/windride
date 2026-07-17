import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WindRibbon } from './WindRibbon';

describe('<WindRibbon />', () => {
  it('renders one rect per segment with a descriptive accessible label', () => {
    const { container } = render(
      <WindRibbon
        segments={[
          { fraction: 0.5, kind: 'tail' },
          { fraction: 0.5, kind: 'head' },
        ]}
      />,
    );
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('aria-label', 'Wind mix: 50% tailwind, 50% headwind');
    expect(container.querySelectorAll('rect.wr-ribbon__seg')).toHaveLength(2);
  });

  it('renders an empty state with no data', () => {
    const { container } = render(<WindRibbon segments={[]} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'No wind data');
    expect(container.querySelectorAll('rect.wr-ribbon__empty')).toHaveLength(1);
  });
});
