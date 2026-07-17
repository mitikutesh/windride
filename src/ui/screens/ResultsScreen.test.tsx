import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CandidateRoute, Segment, WindSample } from '../../domain';

// The MapLibre map needs WebGL (unavailable in jsdom) and isn't unit-tested (testing policy);
// mock it so the Results test focuses on the cards + selection sync.
vi.mock('../components/RouteMap', () => ({
  RouteMap: () => <div data-testid="route-map-mock" />,
}));
import { scoreCandidates } from '../../engine/scoring';
import { useResultsStore } from '../../state/resultsStore';
import { ResultsScreen } from './ResultsScreen';

function candidate(id: string, bearing: number): CandidateRoute {
  const seg: Segment = {
    a: { lat: 60, lon: 24 },
    b: { lat: 60.001, lon: 24.001 },
    lengthM: 1000,
    bearingDeg: bearing,
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
  const { ranked } = scoreCandidates(
    [
      { candidate: candidate('A', 45), windBySegment: steady() },
      { candidate: candidate('B', 225), windBySegment: steady() },
      { candidate: candidate('C', 135), windBySegment: steady() },
    ],
    { targetDistanceM: 10_000 },
  );
  useResultsStore.getState().setResults({ ranked, rejected: [] });
  return ranked;
}

describe('<ResultsScreen />', () => {
  it('renders the top-3 cards with wind-aware ETA captions', () => {
    seed();
    render(<ResultsScreen />);
    expect(screen.getByText('Route A')).toBeInTheDocument();
    expect(screen.getByText('Route B')).toBeInTheDocument();
    expect(screen.getByText('Route C')).toBeInTheDocument();
    expect(screen.getAllByText('Wind-aware ETA').length).toBeGreaterThan(0);
  });

  it('selecting a card updates the results store selection (map syncs off it)', () => {
    const ranked = seed();
    render(<ResultsScreen />);
    expect(useResultsStore.getState().selectedId).toBe(ranked[0].candidate.id);
    fireEvent.click(screen.getByRole('button', { name: /Route B/ }));
    expect(useResultsStore.getState().selectedId).toBe(ranked[1].candidate.id);
  });

  it('shows an empty state when there are no results', () => {
    useResultsStore.getState().clear();
    render(<ResultsScreen />);
    expect(screen.getByText(/No routes yet/i)).toBeInTheDocument();
  });
});
