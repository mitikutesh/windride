import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CandidateRoute, Segment, WindSample } from '../../domain';
import { scoreCandidates } from '../../engine/scoring';
import { useResultsStore } from '../../state/resultsStore';
import { RideScreen } from './RideScreen';

function candidate(id: string): CandidateRoute {
  const seg: Segment = {
    a: { lat: 60, lon: 24 },
    b: { lat: 60.001, lon: 24.001 },
    lengthM: 1000,
    bearingDeg: 45,
    gradePct: 0,
    surface: 'paved',
    exposure: 1,
  };
  return {
    id,
    polyline: [
      { lat: 60, lon: 24 },
      { lat: 60.05, lon: 24.05 },
    ],
    segments: Array.from({ length: 10 }, () => ({ ...seg })),
    distanceM: 10_000,
    ascentM: 0,
    steps: [],
  };
}
function steady(): WindSample[][] {
  const s: WindSample = {
    windMs: 8,
    windFromDeg: 225,
    gustMs: 12,
    precipProb: 10,
    tempC: 17,
    time: '2026-07-10T17:00',
  };
  return Array.from({ length: 10 }, () => [s, s, s]);
}
function seed() {
  const { ranked } = scoreCandidates([{ candidate: candidate('A'), windBySegment: steady() }], {
    targetDistanceM: 10_000,
  });
  useResultsStore.getState().setResults({ ranked, rejected: [] });
}

describe('<RideScreen />', () => {
  it('shows an empty state when no route is selected', () => {
    useResultsStore.getState().clear();
    render(<RideScreen />);
    expect(screen.getByText(/Pick a route/i)).toBeInTheDocument();
  });

  it('renders the glance zone and start control for the selected route', () => {
    seed();
    render(<RideScreen />);
    expect(screen.getByText('km left')).toBeInTheDocument();
    expect(screen.getByText('ETA')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start ride/i })).toBeInTheDocument();
  });

  it('start → pause → resume flow swaps the controls', () => {
    seed();
    render(<RideScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Start ride/i }));
    expect(screen.getByRole('button', { name: /^Pause$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Pause$/i }));
    expect(screen.getByRole('button', { name: /Resume/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /End ride/i })).toBeInTheDocument();
  });

  it('battery-saver toggle flips on click', () => {
    seed();
    render(<RideScreen />);
    const saver = screen.getByRole('checkbox', { name: /Battery saver/i });
    expect(saver).not.toBeChecked();
    fireEvent.click(saver);
    expect(saver).toBeChecked();
  });
});
