import { useDiscoveryStore } from '../../state/discoveryStore';
import { usePlanStore } from '../../state/planStore';

/**
 * "Discover scenic routes" action (WR-047). Opt-in: the parent mounts this only when AI is set up.
 * Asks the AI for scenic directions, builds + wind-scores real loops toward them (in the store, not
 * here), and — on success — publishes them to the Results grid and navigates there. Uses the CURRENT
 * plan inputs (distance/surface/start), so it sits next to the main Plan action.
 */
export function DiscoverRoutesButton() {
  const status = useDiscoveryStore((s) => s.status);
  const error = useDiscoveryStore((s) => s.error);
  const discover = useDiscoveryStore((s) => s.discover);
  const loading = status === 'loading';

  return (
    <div className="wr-discover">
      <button
        type="button"
        className="wr-navlink"
        disabled={loading}
        onClick={() => void discover(usePlanStore.getState().inputs)}
      >
        {loading ? 'Discovering scenic routes…' : '✨ Discover scenic routes (AI)'}
      </button>
      {status === 'error' && error ? (
        <p className="wr-muted" aria-live="polite">
          {error}
        </p>
      ) : null}
    </div>
  );
}
