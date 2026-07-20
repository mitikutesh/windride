// state/useCapabilities.ts — reactive bridge from the keychain store to the pure capabilities model
// (WR-050). Subscribes to the keychain pieces that matter so any dependent UI (a notice, a gated
// feature) flips live the moment a key/provider is added — the routing banner already worked this
// way (DEC-036); this generalises it to routing/transit/AI from one place.
import { capabilities, type CapabilityName, type CapabilityStatus } from '../engine/capabilities';
import { effectiveLiveApis, routingKeyAvailable, useKeychainStore } from './keychainStore';

export function useCapability(name: CapabilityName): CapabilityStatus {
  const keys = useKeychainStore((s) => s.keys);
  const aiProvider = useKeychainStore((s) => s.aiProvider);
  const liveApis = useKeychainStore((s) => s.liveApis);

  const live = liveApis ?? effectiveLiveApis();
  return capabilities({
    liveApis: live,
    // A routing key from EITHER the runtime keychain OR the build-time env fallback counts (DEC-036).
    hasRoutingKey: Boolean(keys.ors) || routingKeyAvailable(),
    hasDigitransitKey: Boolean(keys.digitransit),
    aiProvider: aiProvider ?? null,
    hasAiKey: Boolean(keys.ai),
  })[name];
}
