import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RecordedRide } from '../../data/db';
import { useKeychainStore } from '../../state/keychainStore';
import { useRecapStore } from '../../state/recapStore';
import { RideRecap } from './RideRecap';

const withPlan: RecordedRide = {
  id: 'r1',
  name: 'Ride',
  startedAt: 1,
  status: 'finished',
  summary: {
    distanceM: 40000,
    elapsedS: 7200,
    movingS: 6600,
    avgSpeedMs: 6,
    windByKindS: { tail: 3300, cross: 1650, head: 1650 },
  },
};
const noPlan: RecordedRide = {
  ...withPlan,
  id: 'r2',
  summary: { distanceM: 40000, elapsedS: 7200, movingS: 6600, avgSpeedMs: 6 },
};

beforeEach(() => {
  useRecapStore.getState().reset();
  useKeychainStore.setState({ keys: {}, aiProvider: null });
});

function enableAi() {
  useKeychainStore.setState({ keys: { ai: 'k' }, aiProvider: 'anthropic' });
}

describe('RideRecap', () => {
  it('renders nothing when AI is not set up', () => {
    const { container } = render(<RideRecap ride={withPlan} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a ride with no linked plan (no wind data)', () => {
    enableAi();
    const { container } = render(<RideRecap ride={noPlan} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the recap action for a plan-linked ride when AI is set up', () => {
    enableAi();
    render(<RideRecap ride={withPlan} />);
    expect(screen.getByRole('button', { name: /recap/i })).toBeInTheDocument();
  });

  it('shows a ready recap for this ride', () => {
    enableAi();
    useRecapStore.setState({
      status: 'ready',
      recap: { summary: 'Nice ride', highlights: [] },
      error: null,
      rideId: 'r1',
    });
    render(<RideRecap ride={withPlan} />);
    expect(screen.getByText('Nice ride')).toBeInTheDocument();
  });
});
