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
 * Return-service provider for downwind endpoints (WR-026). Honours the VITE_LIVE_APIS master switch
 * (API_NOTES §6): only when live APIs are enabled does this hit Digitransit. With the switch off it
 * returns a keyless provider that throws a typed 'no-key' error, so the planner degrades to wind-only
 * ranking and never fires a live call while the app is meant to be running fully mocked/offline.
 */
let transitSingleton: DigitransitProvider | undefined;
export function getTransitProvider(): TransitProvider {
  // Keyless (throws 'no-key' → wind-only ranking) when live APIs are off, so a stale key in .env
  // can't fire real calls in mock mode. Live: a singleton, so its cache survives repeated plans.
  if (!liveApisEnabled()) return new DigitransitProvider({ apiKey: '' });
  return (transitSingleton ??= new DigitransitProvider());
}
