import { useCuratedStore } from '../../state/curatedStore';
import { usePlanStore } from '../../state/planStore';

/**
 * "Curated routes near me" action (WR-052). A peer of the main Plan action and of AI discovery
 * (DEC-055c equal-weight buttons) — and unlike discovery it needs no key: the catalog is a static
 * asset shipped with the app. Shortlisting + scoring happen in the store, never here.
 */
export function CuratedRoutesButton() {
  const status = useCuratedStore((s) => s.status);
  const error = useCuratedStore((s) => s.error);
  const findNearby = useCuratedStore((s) => s.findNearby);
  const loading = status === 'loading';

  return (
    <div className="wr-curated">
      <button
        type="button"
        className="wr-btn wr-btn--outline"
        disabled={loading}
        onClick={() => void findNearby(usePlanStore.getState().inputs)}
      >
        {loading ? 'Checking curated routes…' : '🗺️ Curated routes near me'}
      </button>
      {status === 'error' && error ? (
        <p className="wr-muted" aria-live="polite">
          {error}
        </p>
      ) : null}
    </div>
  );
}
