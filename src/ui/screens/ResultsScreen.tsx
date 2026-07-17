import { RouteCard } from '../components/RouteCard';
import { RouteMap } from '../components/RouteMap';
import { PrimaryButton } from '../components';
import { useResultsStore } from '../../state/resultsStore';
import { useSavedRoutesStore } from '../../state/savedRoutesStore';
import { candidateToGpxTrack } from '../routeGeo';
import { downloadText } from '../download';
import { gpxFilename, toGpx } from '../../utils/gpx';
import { localYMD } from '../../utils/units';

/** Results screen (WR-009): top-3 cards synced with a wind-coloured MapLibre route map. */
export function ResultsScreen() {
  const ranked = useResultsStore((s) => s.ranked);
  const selectedId = useResultsStore((s) => s.selectedId);
  const select = useResultsStore((s) => s.select);
  const shelterDataAvailable = useResultsStore((s) => s.shelterDataAvailable);

  if (ranked.length === 0) {
    return (
      <section className="wr-screen">
        <h1>Your routes</h1>
        <p className="wr-muted">No routes yet — plan a ride, then your top 3 appear here.</p>
      </section>
    );
  }

  // The map and the cards must show the SAME set, so a ghost tap always maps to a visible card.
  const top3 = ranked.slice(0, 3);
  const selected = top3.find((c) => c.candidate.id === selectedId) ?? top3[0];
  const routeName = `WindRide ${selected.evidence.distanceKm.toFixed(0)} km`;

  const exportGpx = () => {
    const xml = toGpx(candidateToGpxTrack(selected, routeName));
    downloadText(
      gpxFilename(selected.evidence.distanceKm, localYMD(new Date())),
      'application/gpx+xml',
      xml,
    );
  };
  const saveRoute = () =>
    void useSavedRoutesStore.getState().save({
      id: crypto.randomUUID(), // persistence identity, not the generation cache key
      name: routeName,
      savedAt: Date.now(),
      distanceKm: selected.evidence.distanceKm,
      ascentM: selected.evidence.ascentM,
      track: candidateToGpxTrack(selected, routeName),
    });

  return (
    <section className="wr-results">
      <RouteMap candidates={top3} selectedId={selectedId} onSelect={select} />
      <div className="wr-results__cards">
        <h1>Your routes</h1>
        {!shelterDataAvailable ? (
          <p className="wr-muted">No shelter data here — wind shown without forest sheltering.</p>
        ) : null}
        <div className="wr-results__actions">
          <PrimaryButton onClick={exportGpx}>Export GPX</PrimaryButton>
          <a className="wr-navlink" href="#/ride">
            Ride this route →
          </a>
          <button type="button" className="wr-navlink" onClick={saveRoute}>
            Save route
          </button>
        </div>
        {top3.map((sc) => (
          <RouteCard
            key={sc.candidate.id}
            scored={sc}
            rank={sc.rank}
            selected={sc.candidate.id === selectedId}
            onSelect={() => select(sc.candidate.id)}
          />
        ))}
      </div>
    </section>
  );
}
