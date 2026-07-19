// state/rerouter.ts — builds a live Rerouter with the current routing provider + ride profile.
// Lives in state (not UI) so the module boundary holds: UI must not import adapters directly.
import { getProviders } from '../adapters/registry';
import { Rerouter } from '../nav/offRoute';
import { orsProfile } from './plan/profiles';
import { usePlanStore } from './planStore';

/**
 * A Rerouter wired to the live router, using the current surface preference's bike profile (captured
 * at ride start — it matches the plan unless the owner changed surface without re-planning).
 */
export function makeRerouter(): Rerouter {
  return new Rerouter(getProviders().routing, orsProfile(usePlanStore.getState().inputs.surface));
}
