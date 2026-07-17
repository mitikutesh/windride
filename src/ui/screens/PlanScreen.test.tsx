import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlanScreen } from './PlanScreen';
import { usePlanStore } from '../../state/planStore';
import { useResultsStore } from '../../state/resultsStore';
import { useSavedRoutesStore } from '../../state/savedRoutesStore';

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

  it('lists a saved route and deletes it', async () => {
    vi.stubEnv('VITE_LIVE_APIS', 'false');
    await useSavedRoutesStore.getState().save({
      id: 'plan-saved-1',
      name: 'WindRide 42 km',
      savedAt: 1000,
      distanceKm: 42,
      ascentM: 100,
      track: { name: 'x', creator: 'WindRide', points: [{ lat: 60, lon: 24, ele: 0 }] },
    });
    render(<PlanScreen />);
    await waitFor(() => expect(screen.getByText(/WindRide 42 km/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Delete/i }));
    await waitFor(() => expect(screen.queryByText(/WindRide 42 km/)).not.toBeInTheDocument());
    vi.unstubAllEnvs();
  });
});
