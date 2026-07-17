import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlanScreen } from './PlanScreen';
import { usePlanStore } from '../../state/planStore';
import { useResultsStore } from '../../state/resultsStore';

describe('<PlanScreen /> (mock pipeline)', () => {
  it('changing distance and generating populates the results store', async () => {
    vi.stubEnv('VITE_LIVE_APIS', 'false'); // mocks
    useResultsStore.getState().clear();

    render(<PlanScreen />);

    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '80' } });
    expect(usePlanStore.getState().inputs.distanceKm).toBe(80);

    fireEvent.click(screen.getByRole('button', { name: /find today's route/i }));

    await waitFor(() => expect(useResultsStore.getState().ranked.length).toBeGreaterThan(0), {
      timeout: 4000,
    });
    expect(useResultsStore.getState().ranked[0].explanation).toMatch(/wind-aware ETA/);
    vi.unstubAllEnvs();
  });

  it('renders the conditions strip once weather loads', async () => {
    vi.stubEnv('VITE_LIVE_APIS', 'false');
    render(<PlanScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Current conditions/i)).toBeInTheDocument());
    vi.unstubAllEnvs();
  });
});
