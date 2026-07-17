// adapters/registry.ts — the one place the app picks providers (WR-003).
// Mocks unless VITE_LIVE_APIS === "true"; live adapters are wired in WR-004/WR-005.
import type { RouteProvider } from './routing';
import type { WeatherProvider } from './weather';
import { MockRouteProvider } from './routing/mock';
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
    // Live weather is wired in WR-004; live routing (ORS) lands in WR-005, so routing stays mock.
    return { weather: new OpenMeteoProvider(), routing: new MockRouteProvider() };
  }
  return { weather: new MockWeatherProvider(), routing: new MockRouteProvider() };
}
