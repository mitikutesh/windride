import { buildFeelsProfile } from '../../engine/feelsProfile';
import { RouteCard } from '../components/RouteCard';
import { RouteMap } from '../components/RouteMap';
import { HeatStrip } from '../components/HeatStrip';
import { FeelsChart } from '../components/FeelsChart';
import { RideBriefing } from '../components/RideBriefing';
import { ScenicSpots } from '../components/ScenicSpots';
import { WinterCaution } from '../components/WinterCaution';
import { WindLegend } from '../components/WindLegend';
import { PrimaryButton } from '../components';
import { useDiscoveryStore } from '../../state/discoveryStore';
import { useKeychainStore } from '../../state/keychainStore';
import { usePlanStore } from '../../state/planStore';
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
  const startMatrix = useResultsStore((s) => s.startMatrix);
  const startMessage = useResultsStore((s) => s.startMessage);
  const hourLabels = useResultsStore((s) => s.hourLabels);
  const winter = useResultsStore((s) => s.winter);
  const conditions = usePlanStore((s) => s.conditions);
  const departureHour = usePlanStore((s) => s.inputs.departureHour);
  // AI briefing is opt-in: shown only when the user has picked a provider AND set its key (DEC-043).
  const aiReady = useKeychainStore((s) => Boolean(s.aiProvider && s.keys.ai));
  const discoveryNotes = useDiscoveryStore((s) => s.notes);

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

  // Heat strip for the selected route (WR-020): its matrix row, coloured across the whole matrix.
  const selectedRow = startMatrix?.rows.find((r) => r.candidate.id === selected.candidate.id);
  const allTotals =
    startMatrix?.rows.flatMap((r) =>
      r.cells.map((c) => c.total).filter((t): t is number => t !== null),
    ) ?? [];
  const heatMin = allTotals.length ? Math.min(...allTotals) : 0;
  const heatMax = allTotals.length ? Math.max(...allTotals) : 1;
  const bestHour = selectedRow?.cells.reduce<{ h: number; t: number } | null>((acc, c) => {
    if (c.total === null) return acc;
    return !acc || c.total > acc.t ? { h: c.hourIndex, t: c.total } : acc;
  }, null);

  return (
    <section className="wr-results">
      <RouteMap candidates={top3} selectedId={selectedId} onSelect={select} />
      <div className="wr-results__cards">
        <h1>Your routes</h1>
        <WinterCaution winter={winter} />
        <WindLegend />
        {!shelterDataAvailable ? (
          <p className="wr-muted">No shelter data here — wind shown without forest sheltering.</p>
        ) : null}
        {startMessage ? <p className="wr-results__when">{startMessage}</p> : null}
        {discoveryNotes[selected.candidate.id] ? (
          <p className="wr-results__discovery">✨ {discoveryNotes[selected.candidate.id]}</p>
        ) : null}
        {selectedRow && selectedRow.cells.length > 0 ? (
          <HeatStrip
            cells={selectedRow.cells}
            min={heatMin}
            max={heatMax}
            bestHourIndex={bestHour?.h}
            nowHourIndex={0}
            hourLabel={(h) => hourLabels[h] ?? `+${h}h`}
            ariaLabel="Best departure hour for the selected route"
          />
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

        <details className="wr-results__detail">
          <summary>Elevation & feels-like — {selected.evidence.distanceKm.toFixed(1)} km</summary>
          <FeelsChart points={buildFeelsProfile(selected.analysis.segments)} />
        </details>

        <details className="wr-results__detail">
          <summary>Scenic spots along this route</summary>
          <ScenicSpots
            route={{ id: selected.candidate.id, polyline: selected.candidate.polyline }}
          />
        </details>

        {aiReady ? (
          <details className="wr-results__detail">
            <summary>Today’s ride briefing (AI)</summary>
            <RideBriefing
              scored={selected}
              cond={
                conditions
                  ? {
                      tempC: conditions.tempC ?? null,
                      feelsC: conditions.feelsC ?? null,
                      windMs: conditions.windMs,
                      windFromDeg: conditions.windFromDeg,
                      gustMs: conditions.gustMs,
                      precipProb: conditions.precipProb,
                      sunset: conditions.sunset ?? null,
                    }
                  : null
              }
              winter={winter ? { iceRisk: winter.iceRisk, minTempC: winter.minTempC } : null}
              departureHour={departureHour}
            />
          </details>
        ) : null}
      </div>
    </section>
  );
}
