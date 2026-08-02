import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { CandidateRoute, Segment, WindSample } from '../../domain';
import type { Fix } from '../../nav/fixSource';
import { scoreCandidates } from '../../engine/scoring';
import { useResultsStore } from '../../state/resultsStore';
import { useRideSettingsStore } from '../../state/rideSettingsStore';

// GeolocationSource needs a real browser; mock it so we can assert start/stop lifecycle AND drive
// fixes through the live pipeline (the reroute-flow test walks a rider off the route).
const geo = vi.hoisted(() => ({
  stop: vi.fn(),
  started: 0,
  onFix: null as null | ((f: Fix) => void),
}));
vi.mock('../../nav/locationService', () => ({
  GeolocationSource: class {
    start(cb: (f: Fix) => void) {
      geo.started += 1;
      geo.onFix = cb;
    }
    stop() {
      geo.stop();
    }
  },
}));

// The Rerouter talks to the live router — stub it with a canned rejoin leg (fixtures-only policy).
// `defer: true` parks the result until release() fires, to exercise the mid-fetch stale guards.
const reroute = vi.hoisted(() => ({
  attempts: 0,
  defer: false,
  release: null as null | (() => void),
}));
vi.mock('../../state/rerouter', () => ({
  makeRerouter: () => ({
    attempt: () => {
      reroute.attempts += 1;
      const seg = {
        a: { lat: 60.002, lon: 24 },
        b: { lat: 60.004, lon: 24.004 },
        lengthM: 500,
        bearingDeg: 45,
        gradePct: 0,
        surface: 'paved',
        exposure: 1,
      };
      const result = {
        ok: true,
        rejoinAtM: 600,
        route: {
          id: 'detour',
          polyline: [seg.a, seg.b],
          segments: [seg],
          distanceM: 500,
          ascentM: 0,
        },
      };
      if (!reroute.defer) return Promise.resolve(result);
      return new Promise((resolve) => {
        reroute.release = () => resolve(result);
      });
    },
  }),
}));

import { RideScreen } from './RideScreen';

/**
 * A candidate whose steps are three maneuvers that the pre-WR-056 glyph could not tell apart:
 * "Keep left", "Turn left" and a roundabout (whose text contains no direction word at all).
 */
function candidateWithTurns(): CandidateRoute {
  const c = candidate('T');
  // ~30 m between vertices, so the two maneuvers land close enough to chain (< CUE_CHAIN_M).
  const dLon = 30 / (111_320 * Math.cos((60 * Math.PI) / 180));
  return {
    ...c,
    polyline: Array.from({ length: 20 }, (_v, i) => ({ lat: 60, lon: 24 + i * dLon })),
    steps: [
      { instruction: 'Head east', distanceM: 0, type: 11, wayPoints: [0, 0] },
      { instruction: 'Keep left', distanceM: 0, type: 12, wayPoints: [10, 10] }, // ~300 m in
      {
        instruction: 'Enter the roundabout and take the 2nd exit onto Kehatie',
        distanceM: 0,
        type: 7,
        wayPoints: [11, 11], // ~30 m later — chains onto the Keep left
      },
    ],
  };
}

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
    expect(screen.getByText('km/h')).toBeInTheDocument();
    expect(screen.getByText('ETA')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start ride/i })).toBeInTheDocument();
  });

  it('start → pause → resume flow swaps the live controls', () => {
    seed();
    render(<RideScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Start ride/i }));
    // Full-screen live view: End is always reachable, Pause toggles to Resume.
    expect(screen.getByRole('button', { name: /^End$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Pause$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Pause$/i }));
    expect(screen.getByRole('button', { name: /Resume/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^End$/i })).toBeInTheDocument();
  });

  it('the Details toggle reveals the extra ride stats while riding', () => {
    seed();
    render(<RideScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Start ride/i }));
    expect(screen.queryByText('km ridden')).not.toBeInTheDocument(); // hidden by default
    fireEvent.click(screen.getByRole('button', { name: /Details/i }));
    expect(screen.getByText('km ridden')).toBeInTheDocument();
  });

  it('battery-saver toggle flips on click', () => {
    seed();
    render(<RideScreen />);
    const saver = screen.getByRole('checkbox', { name: /Battery saver/i });
    expect(saver).not.toBeChecked();
    fireEvent.click(saver);
    expect(saver).toBeChecked();
  });

  it('stops GPS when the ride screen unmounts mid-ride', () => {
    seed();
    geo.stop.mockClear();
    const { unmount } = render(<RideScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Start ride/i }));
    unmount();
    expect(geo.stop).toHaveBeenCalled();
  });

  it('off-route asks before rerouting, previews the new route, and applies only on Accept (WR-051)', async () => {
    seed();
    reroute.attempts = 0;
    render(<RideScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Start ride/i }));

    const t0 = Date.parse('2026-07-10T09:00:00Z');
    const fixAt = (lat: number, lon: number, s: number): Fix => ({
      lat,
      lon,
      time: new Date(t0 + s * 1000).toISOString(),
      speed: 5,
    });
    // Latch on-route at the start point, then ride ~100 m beside the track for >10 s.
    act(() => geo.onFix?.(fixAt(60, 24, 0)));
    for (let s = 1; s <= 13; s++) act(() => geo.onFix?.(fixAt(60.002, 24, s)));

    // 1) Sustained off-route ⇒ the app ASKS — nothing was fetched yet.
    expect(await screen.findByText(/reroute back to your planned route\?/i)).toBeInTheDocument();
    expect(reroute.attempts).toBe(0);

    // 2) Rider confirms ⇒ one fetch, shown as a PREVIEW — still not applied.
    fireEvent.click(screen.getByRole('button', { name: /^Reroute$/i }));
    expect(await screen.findByText(/rejoins your planned route ahead/i)).toBeInTheDocument();
    expect(reroute.attempts).toBe(1);

    // 3) Rider accepts ⇒ the dialog closes and the ride continues on the new route.
    fireEvent.click(screen.getByRole('button', { name: /^Accept$/i }));
    expect(screen.queryByRole('alertdialog', { name: /Reroute/i })).not.toBeInTheDocument();
  });

  it('declining the offer keeps the planned route and does not call the router (WR-051)', async () => {
    seed();
    reroute.attempts = 0;
    render(<RideScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Start ride/i }));

    const t0 = Date.parse('2026-07-10T10:00:00Z');
    act(() => geo.onFix?.({ lat: 60, lon: 24, time: new Date(t0).toISOString(), speed: 5 }));
    for (let s = 1; s <= 13; s++) {
      act(() =>
        geo.onFix?.({
          lat: 60.002,
          lon: 24,
          time: new Date(t0 + s * 1000).toISOString(),
          speed: 5,
        }),
      );
    }
    fireEvent.click(await screen.findByRole('button', { name: /No thanks/i }));
    expect(screen.queryByRole('alertdialog', { name: /Reroute/i })).not.toBeInTheDocument();
    // Still off-route on the next fix — but the episode was declined, so no re-offer, no fetch.
    act(() =>
      geo.onFix?.({ lat: 60.002, lon: 24, time: new Date(t0 + 14_000).toISOString(), speed: 5 }),
    );
    expect(screen.queryByRole('alertdialog', { name: /Reroute/i })).not.toBeInTheDocument();
    expect(reroute.attempts).toBe(0);
  });

  it('a rider who rejoins mid-fetch gets no stale dialog (WR-051)', async () => {
    seed();
    reroute.attempts = 0;
    reroute.defer = true;
    try {
      render(<RideScreen />);
      fireEvent.click(screen.getByRole('button', { name: /Start ride/i }));

      const t0 = Date.parse('2026-07-10T11:00:00Z');
      const fixAt = (lat: number, lon: number, s: number): Fix => ({
        lat,
        lon,
        time: new Date(t0 + s * 1000).toISOString(),
        speed: 5,
      });
      act(() => geo.onFix?.(fixAt(60, 24, 0)));
      for (let s = 1; s <= 13; s++) act(() => geo.onFix?.(fixAt(60.002, 24, s)));
      fireEvent.click(await screen.findByRole('button', { name: /^Reroute$/i }));
      expect(screen.getByText(/Finding a way back/i)).toBeInTheDocument();

      // The rider finds their own way back onto the track while the leg is still loading…
      act(() => geo.onFix?.(fixAt(60.0005, 24.0005, 14)));
      // …then the fetch resolves: the proposal is stale and must be discarded, not previewed.
      await act(async () => {
        reroute.release?.();
      });
      expect(screen.queryByText(/rejoins your planned route/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('alertdialog', { name: /Reroute/i })).not.toBeInTheDocument();
    } finally {
      reroute.defer = false;
      reroute.release = null;
    }
  });

  // --- turn glyph (WR-056) -----------------------------------------------------------------
  it('draws the arrow from the maneuver KIND, not by keyword-matching the instruction', () => {
    const { ranked } = scoreCandidates(
      [{ candidate: candidateWithTurns(), windBySegment: steady() }],
      {
        targetDistanceM: 10_000,
      },
    );
    useResultsStore.getState().setResults({ ranked, rejected: [] });
    const { container } = render(<RideScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Start ride/i }));
    act(() => geo.onFix?.({ lat: 60, lon: 24, time: '2026-07-10T14:00:00Z', speed: 5 }));

    // The first maneuver is "Keep left" — which the old glyph drew identically to "Turn left".
    expect(screen.getByLabelText('Next turn')).toBeInTheDocument();
    expect(container.querySelector('[data-turn-kind]')).toHaveAttribute(
      'data-turn-kind',
      'keep-left',
    );
    // The roundabout follows within CUE_CHAIN_M, so it rides along as the "then" hint rather than
    // being announced separately — and it is drawn as a roundabout, not as "straight ahead".
    const kinds = [...container.querySelectorAll('[data-turn-kind]')].map((el) =>
      el.getAttribute('data-turn-kind'),
    );
    expect(kinds).toContain('roundabout');
  });

  // --- map orientation (WR-053) ------------------------------------------------------------
  it('offers a heading-up toggle once riding, on by default, and flips it', () => {
    seed();
    useRideSettingsStore.setState({ mapOrientation: 'heading-up' });
    render(<RideScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Start ride/i }));
    act(() => geo.onFix?.({ lat: 60, lon: 24, time: '2026-07-10T12:00:00Z', speed: 5 }));

    const toggle = screen.getByRole('button', { name: /Rotate map to my heading/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(/follows your heading/i);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(useRideSettingsStore.getState().mapOrientation).toBe('north-up');
    expect(screen.getByRole('status')).toHaveTextContent(/north-up/i);
  });

  it('holds north-up while a reroute proposal is being previewed', async () => {
    seed();
    useRideSettingsStore.setState({ mapOrientation: 'heading-up' });
    render(<RideScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Start ride/i }));

    const t0 = Date.parse('2026-07-10T13:00:00Z');
    const fixAt = (lat: number, lon: number, s: number): Fix => ({
      lat,
      lon,
      time: new Date(t0 + s * 1000).toISOString(),
      speed: 5,
    });
    act(() => geo.onFix?.(fixAt(60, 24, 0)));
    expect(screen.getByRole('status')).toHaveTextContent(/follows your heading/i);

    for (let s = 1; s <= 13; s++) act(() => geo.onFix?.(fixAt(60.002, 24, s)));
    fireEvent.click(await screen.findByRole('button', { name: /^Reroute$/i }));
    await screen.findByText(/rejoins your planned route ahead/i);
    // The dashed proposal must be framed, not rotated off the edge of a rider-biased map...
    expect(screen.getByRole('status')).toHaveTextContent(/north-up/i);
    // ...and the rider's own preference is untouched, so it returns on Accept.
    expect(useRideSettingsStore.getState().mapOrientation).toBe('heading-up');
    fireEvent.click(screen.getByRole('button', { name: /^Accept$/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/follows your heading/i);
  });
});
