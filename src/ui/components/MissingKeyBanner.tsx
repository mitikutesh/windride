import {
  effectiveLiveApis,
  routingKeyAvailable,
  useKeychainStore,
} from '../../state/keychainStore';

/**
 * First-run onboarding for shared builds (task #33 follow-up): when live routing is on but no
 * openrouteservice key exists from any source (the user's own key OR a build-time env fallback),
 * point the user at Kit → API keys. Renders nothing once a key is available or in mock mode.
 */
export function MissingKeyBanner() {
  // Subscribe to the pieces that change so the banner re-renders when a key is added / live toggled.
  const orsSet = useKeychainStore((s) => Boolean(s.keys.ors));
  const liveApis = useKeychainStore((s) => s.liveApis);
  const live = liveApis ?? effectiveLiveApis();
  const hasRouting = orsSet || routingKeyAvailable();
  if (!live || hasRouting) return null;

  return (
    <div className="wr-keyprompt" role="status">
      <span>
        Live routing is on but no <strong>openrouteservice</strong> key is set — real routes need
        one (free tier at openrouteservice.org).
      </span>
      <a className="wr-navlink" href="#/kit">
        Add your key →
      </a>
    </div>
  );
}
