import { useCapability } from '../../state/useCapabilities';

/**
 * First-run onboarding for shared builds (task #33 / DEC-036), now sourced from the shared
 * capabilities model (WR-050): when live routing has no openrouteservice key from any source, point
 * the user at Kit. Renders nothing once a key is available or in mock mode. Kept as its own banner
 * (distinct styling) but the ready/reason/link decision lives in one place now.
 */
export function MissingKeyBanner() {
  const routing = useCapability('routing');
  if (routing.ready || !routing.reason) return null;

  return (
    <div className="wr-keyprompt" role="status">
      <span>{routing.reason}</span>
      <a className="wr-navlink" href={routing.fixHref}>
        Add your key →
      </a>
    </div>
  );
}
