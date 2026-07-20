import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Briefing, BriefingConditions } from '../../engine/briefing';
import type { ScoredCandidate } from '../../engine/scoring';
import { useBriefingStore } from '../../state/briefingStore';
import { RideBriefing } from './RideBriefing';

const scored = { candidate: { id: 'r1' } } as unknown as ScoredCandidate;
const cond: BriefingConditions = {
  tempC: 12,
  feelsC: 10,
  windMs: 6,
  windFromDeg: 200,
  gustMs: 9,
  precipProb: 10,
  sunset: '2026-07-20T22:00:00Z',
};
const briefing: Briefing = {
  summary: 'Cool and breezy — layer up.',
  clothing: ['Light jacket', 'Full gloves'],
  fuel: 'One bottle should do.',
  safety: ['Exposed coast stretch is gusty.'],
};

beforeEach(() => useBriefingStore.getState().reset());

describe('RideBriefing', () => {
  it('offers the briefing action when conditions are loaded', () => {
    render(<RideBriefing scored={scored} cond={cond} />);
    const btn = screen.getByRole('button', { name: /briefing/i });
    expect(btn).toBeEnabled();
  });

  it('disables the action with a hint when conditions are not loaded yet', () => {
    render(<RideBriefing scored={scored} cond={null} />);
    expect(screen.getByRole('button', { name: /briefing/i })).toBeDisabled();
    expect(screen.getByText(/conditions aren’t loaded yet/i)).toBeInTheDocument();
  });

  it('renders the sections once a briefing is ready for this route', () => {
    useBriefingStore.setState({ status: 'ready', briefing, error: null, routeId: 'r1' });
    render(<RideBriefing scored={scored} cond={cond} />);
    expect(screen.getByText(briefing.summary)).toBeInTheDocument();
    expect(screen.getByText('Light jacket')).toBeInTheDocument();
    expect(screen.getByText(briefing.fuel)).toBeInTheDocument();
    expect(screen.getByText('Exposed coast stretch is gusty.')).toBeInTheDocument();
  });

  it('does not show a briefing that belongs to a different route (stale guard)', () => {
    useBriefingStore.setState({ status: 'ready', briefing, error: null, routeId: 'other' });
    render(<RideBriefing scored={scored} cond={cond} />);
    expect(screen.queryByText(briefing.summary)).not.toBeInTheDocument();
  });
});
