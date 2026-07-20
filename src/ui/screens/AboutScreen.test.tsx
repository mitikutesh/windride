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
    // A few more weighted sub-scores are present, incl. Novelty (live in the engine — WR-028).
    expect(within(table).getByRole('row', { name: /Crosswind safety/i })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /Robustness/i })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /Novelty/i })).toBeInTheDocument();
  });

  it('frames the account honestly: optional, keys never synced, links Privacy (WR-043)', () => {
    render(<AboutScreen />);
    expect(screen.getByText(/optional free account/i)).toBeInTheDocument();
    expect(screen.getByText(/no account needed/i)).toBeInTheDocument(); // progressive/anonymous
    expect(screen.getByRole('link', { name: /^Privacy$/i })).toHaveAttribute('href', '#/privacy');
  });

  it('no longer makes the old "no backend / no account" absolute claims (WR-043)', () => {
    render(<AboutScreen />);
    expect(screen.queryByText(/No backend, no account/i)).toBeNull();
    expect(screen.queryByText(/nothing to pay to run it/i)).toBeNull();
  });
});
