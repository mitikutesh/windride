import type { CapabilityName } from '../../engine/capabilities';
import { useCapability } from '../../state/useCapabilities';

/**
 * A consistent "this feature needs setup" notice (WR-050): shows the specific reason + a link to the
 * exact Kit destination when a capability isn't ready, and renders nothing when it is. One component
 * so every missing-key message across the app reads the same way and stays honest.
 */
export function CapabilityNotice({ capability }: { capability: CapabilityName }) {
  const cap = useCapability(capability);
  if (cap.ready || !cap.reason) return null;
  return (
    <p className={`wr-capnotice${cap.soft ? ' wr-capnotice--soft' : ''}`} role="status">
      {cap.reason}{' '}
      <a className="wr-link" href={cap.fixHref}>
        {cap.fixLabel} →
      </a>
    </p>
  );
}
