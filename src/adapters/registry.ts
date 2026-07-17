// adapters/registry.ts — the one place the app picks providers (WR-003).
// Mocks unless VITE_LIVE_APIS === "true"; live adapters are wired in WR-004/WR-005.
import type { RouteProvider } from './routing';
import type { WeatherProvider } from './weather';
import { MockRouteProvider } from './routing/mock';
import { MockWeatherProvider } from './weather/mock';

export interface Providers {
  weather: WeatherProvider;
  routing: RouteProvider;
}

export function liveApisEnabled(): boolean {
  return import.meta.env.VITE_LIVE_APIS === 'true';
}

export function getProviders(): Providers {
  if (liveApisEnabled()) {
    // Live weather (WR-004) and routing (WR-005) adapters are not built yet. Fail loudly rather
    // than silently returning mocks so a misconfigured live run is obvious.
    throw new Error(
      'Live providers are not available yet (WR-004/WR-005). Set VITE_LIVE_APIS=false to use mocks.',
    );
  }
  return { weather: new MockWeatherProvider(), routing: new MockRouteProvider() };
}
