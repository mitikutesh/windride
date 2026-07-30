import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCuratedStore } from '../../state/curatedStore';
import { useResultsStore } from '../../state/resultsStore';
import { CuratedBadge } from './CuratedBadge';
import { CuratedCredit } from './CuratedCredit';
import { CuratedRoutesButton } from './CuratedRoutesButton';

const badge = {
  name: 'Itämeren rengastie',
  label: 'National cycle route · signed on OpenStreetMap',
  kind: 'linear' as const,
  lengthKm: 46.1,
  startDistanceM: 1200,
  partial: false,
};

beforeEach(() => {
  useCuratedStore.getState().reset();
  useResultsStore.getState().clear();
});

describe('<CuratedRoutesButton />', () => {
  it('asks the store for curated routes near the current plan inputs', async () => {
    const findNearby = vi.fn(async () => {});
    useCuratedStore.setState({ findNearby });
    render(<CuratedRoutesButton />);
    await userEvent.click(screen.getByRole('button', { name: /curated routes near me/i }));
    expect(findNearby).toHaveBeenCalledWith(
      expect.objectContaining({ distanceKm: expect.any(Number) }),
    );
  });

  it('shows the store’s honest failure reason', () => {
    useCuratedStore.setState({ status: 'error', error: 'No curated route passes within 5 km' });
    render(<CuratedRoutesButton />);
    expect(screen.getByText(/No curated route passes within 5 km/)).toBeInTheDocument();
  });
});

describe('<CuratedBadge />', () => {
  it('shows provenance and the flat-profile ETA caveat for a curated candidate', () => {
    useCuratedStore.setState({ badges: { 'cur-osm-r-1234567': badge } });
    render(<CuratedBadge candidateId="cur-osm-r-1234567" />);
    expect(screen.getByText(/Itämeren rengastie/)).toBeInTheDocument();
    expect(screen.getByText(/National cycle route/)).toBeInTheDocument();
    expect(screen.getByText(/1\.2 km from your start/)).toBeInTheDocument();
    expect(screen.getByText(/no elevation/i)).toBeInTheDocument();
  });

  it('says when the entry is only the longest mapped section of a signed route', () => {
    useCuratedStore.setState({ badges: { 'cur-osm-r-1': { ...badge, partial: true } } });
    render(<CuratedBadge candidateId="cur-osm-r-1" />);
    expect(screen.getByText(/mapped in pieces/i)).toBeInTheDocument();
  });

  it('renders nothing for an ordinary plan’s candidate', () => {
    useCuratedStore.setState({ badges: { 'cur-osm-r-1234567': badge } });
    const { container } = render(<CuratedBadge candidateId="ors-oab-45" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('<CuratedCredit />', () => {
  const withRanked = (id: string) =>
    useResultsStore.setState({
      ranked: [{ candidate: { id } }] as unknown as ReturnType<
        typeof useResultsStore.getState
      >['ranked'],
    });

  it('credits the catalog sources while curated routes are the results on screen', () => {
    useCuratedStore.setState({ attributions: ['© OpenStreetMap contributors (ODbL)'] });
    withRanked('cur-osm-r-1234567');
    render(<CuratedCredit />);
    expect(screen.getByText(/OpenStreetMap contributors \(ODbL\)/)).toBeInTheDocument();
  });

  it('retires the credit once the results are an ordinary plan again', () => {
    useCuratedStore.setState({ attributions: ['© OpenStreetMap contributors (ODbL)'] });
    withRanked('ors-oab-45');
    const { container } = render(<CuratedCredit />);
    expect(container).toBeEmptyDOMElement();
  });
});
