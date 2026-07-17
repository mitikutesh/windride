// adapters/registry.ts — the one place the app picks providers (WR-003).
// Mocks unless VITE_LIVE_APIS === "true"; live adapters are wired in WR-004/WR-005.
import type { RouteProvider } from './routing';
import type { WeatherProvider } from './weather';
import { MockRouteProvider } from './routing/mock';
import { OrsRouteProvider } from './routing/ors';
import { DigitransitProvider, type TransitProvider } from './transit/digitransit';
import { MockWeatherProvider } from './weather/mock';
import { OpenMeteoProvider } from './weather/openMeteo';

export interface Providers {
  weather: WeatherProvider;
  routing: RouteProvider;
}

export function liveApisEnabled(): boolean {
  return import.meta.env.VITE_LIVE_APIS === 'true';
}

export function getProviders(): Providers {
  if (liveApisEnabled()) {
    // Live weather (WR-004) + live openrouteservice routing (WR-005).
    return { weather: new OpenMeteoProvider(), routing: new OrsRouteProvider() };
  }
  return { weather: new MockWeatherProvider(), routing: new MockRouteProvider() };
}

/**
 * Return-service provider for downwind endpoints (WR-026). Always the real Digitransit adapter — it
 * self-degrades to a typed 'no-key' error when VITE_DIGITRANSIT_KEY is unset, and the planner then
 * ranks by wind alone. There is no mock: without a key the downwind planner simply omits return copy.
 */
export function getTransitProvider(): TransitProvider {
  return new DigitransitProvider();
}
