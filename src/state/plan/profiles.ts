import type { RouteProfile } from '../../domain';

/**
 * ORS cycling profile for a surface preference. "Road" uses cycling-regular (bike-friendly: cycleways
 * + quiet roads), NOT cycling-road (the racing profile that hugs main/state roads); "Gravel" uses
 * cycling-mountain (prefers tracks/unpaved). Shared by planning + live reroute so they never diverge.
 */
export function orsProfile(surface: 'road' | 'gravel'): RouteProfile {
  return surface === 'road' ? 'cycling-regular' : 'cycling-mountain';
}
