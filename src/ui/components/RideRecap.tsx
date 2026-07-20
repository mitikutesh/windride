import type { RecordedRide } from '../../data/db';
import { useRecapStore } from '../../state/recapStore';
import { useCapability } from '../../state/useCapabilities';

interface Props {
  ride: RecordedRide;
}

/**
 * Per-ride post-ride AI recap (WR-049). Opt-in: renders nothing unless AI is set up AND the ride has
 * a computed summary. The AI call lives in recapStore (UI never touches adapters); this is a pure
 * view, tagged by rideId so only the requested ride shows a recap.
 */
export function RideRecap({ ride }: Props) {
  const aiReady = useCapability('ai').ready;
  const status = useRecapStore((s) => s.status);
  const recap = useRecapStore((s) => s.recap);
  const error = useRecapStore((s) => s.error);
  const rideId = useRecapStore((s) => s.rideId);
  const generate = useRecapStore((s) => s.generate);

  // Opt-in AND plan-linked only: a ride with no linked plan (no wind mix) gets no recap, per the
  // story ("rides without a matching plan get no recap") — DEC-048.
  const summary = ride.summary;
  if (!aiReady || !summary?.windByKindS) return null;

  const forThisRide = rideId === ride.id;
  const loading = forThisRide && status === 'loading';
  const ready = forThisRide && status === 'ready' && recap !== null;

  return (
    <div className="wr-recap">
      <button
        type="button"
        className="wr-navlink"
        onClick={() => void generate(ride.id, summary)}
        disabled={loading}
      >
        {loading ? 'Writing…' : ready ? 'Refresh recap' : 'AI recap'}
      </button>
      {ready && recap ? (
        <div className="wr-recap__out">
          <p className="wr-recap__summary">{recap.summary}</p>
          {recap.highlights.length > 0 ? (
            <ul>
              {recap.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {forThisRide && status === 'error' ? <p className="wr-muted">{error}</p> : null}
    </div>
  );
}
