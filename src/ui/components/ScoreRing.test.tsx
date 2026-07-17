import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreRing } from './ScoreRing';

describe('<ScoreRing />', () => {
  it('labels and prints the score', () => {
    render(<ScoreRing score={72} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('aria-label', 'Score 72 out of 100');
    expect(img).toHaveTextContent('72');
  });

  it('clamps the displayed score to 100', () => {
    render(<ScoreRing score={150} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Score 100 out of 100');
  });
});
