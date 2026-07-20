import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AboutScreen } from './AboutScreen';

describe('<AboutScreen />', () => {
  it('explains the wind-aware differentiator (generates, not just analyses)', () => {
    render(<AboutScreen />);
    expect(screen.getByRole('heading', { level: 1, name: /About WindRide/i })).toBeInTheDocument();
    expect(screen.getAllByText(/generates/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/least suffering today/i)).toBeInTheDocument();
  });

  it('lists the scoring sub-scores with their weights', () => {
    render(<AboutScreen />);
    const table = screen.getByRole('table');
    const wind = within(table).getByRole('row', { name: /Wind comfort/i });
    expect(within(wind).getByText('0.28')).toBeInTheDocument();
    // A few more weighted sub-scores are present.
    expect(within(table).getByRole('row', { name: /Crosswind safety/i })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /Robustness/i })).toBeInTheDocument();
  });
});
