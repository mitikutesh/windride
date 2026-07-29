// adapters/registry.ts — the one place the app picks providers (WR-003).
// Mocks unless VITE_LIVE_APIS === "true"; live adapters are wired in WR-004/WR-005.
import { AiHttpClient, type AiClient, type AiProvider } from './ai';
import type { RouteProvider } from './routing';
import type { WeatherProvider } from './weather';
import { MockRouteProvider } from './routing/mock';
import { OrsRouteProvider } from './routing/ors';
import { DigitransitProvider, type TransitProvider } from './transit/digitransit';
import { FmiWeatherProvider } from './weather/fmi';
import { MockWeatherProvider } from './weather/mock';
import { OpenMeteoProvider } from './weather/openMeteo';

export interface Providers {
  weather: WeatherProvider;
  routing: RouteProvider;
}

/** API keys a user can bring their own of (task #33). `ai` powers Epic 6 features (WR-044+). */
export type ApiKeyName = 'ors' | 'digitransit' | 'ai';

export interface RuntimeConfig {
  /** Runtime keys entered by the user (idb-backed); each overrides its Vite-env fallback. */
  keys: Partial<Record<ApiKeyName, string>>;
  /** Master live-APIs switch override: true/false wins, null follows the build-time env default. */
  liveApis: boolean | null;
  /** The AI provider the user picked in Kit (DEC-043); null/undefined = AI features off. */
  aiProvider?: AiProvider | null;
}

// Module-level runtime config (task #33). Adapters stay self-contained — the state layer hydrates
// the keychain from idb and pushes it in via setRuntimeConfig, so the registry never imports up.
let runtime: RuntimeConfig = { keys: {}, liveApis: null, aiProvider: null };

export function setRuntimeConfig(config: RuntimeConfig): void {
  runtime = config;
}

/** A non-empty runtime key, else undefined so the adapter falls back to its Vite-env default. */
function runtimeKey(name: ApiKeyName): string | undefined {
  return runtime.keys[name] || undefined;
}

export function liveApisEnabled(): boolean {
  // A runtime toggle (owner-set in Settings) wins; with none set, follow the build-time env default.
  return runtime.liveApis ?? import.meta.env.VITE_LIVE_APIS === 'true';
}

/** True when live routing has a key from ANY source: the runtime override or, in dev builds only,
 *  the Vite-env fallback (DEC-059 — prod bundles are statically key-free, so prod must not claim
 *  a baked key exists). */
export function hasRoutingKey(): boolean {
  return Boolean(runtimeKey('ors') || (import.meta.env.DEV && import.meta.env.VITE_ORS_API_KEY));
}

/** The AI provider the user picked in Kit, or null when unset (DEC-043). Consumed by WR-045+
 *  features and the WR-050 capability gating (labels the active provider in the UI). */
export function getAiProvider(): AiProvider | null {
  return runtime.aiProvider ?? null;
}

/** True when AI features can run: a provider is chosen AND its key is present (BYO, DEC-043). */
export function aiReady(): boolean {
  return Boolean(runtime.aiProvider && runtimeKey('ai'));
}

/**
 * The AI client for the user's chosen provider + key, or null when AI isn't set up. AI is
 * independent of the live-APIs master switch — it's gated purely on the user having a key + a
 * provider (there is no AI mock; features simply hide when unset, WR-050). The `ai` key comes only
 * from the runtime keychain, never from Vite env (BYO, DEC-040) — so it is never bundled.
 */
export function getAiClient(): AiClient | null {
  const provider = runtime.aiProvider;
  const apiKey = runtime.keys.ai || undefined;
  if (!provider || !apiKey) return null;
  return new AiHttpClient({ provider, apiKey });
}

export function getProviders(): Providers {
  if (liveApisEnabled()) {
    // Live weather: FMI HARMONIE (best Nordic wind) decorating Open-Meteo — FMI where it has data,
    // Open-Meteo everywhere else and for daylight/recent-precip. Routing: live openrouteservice,
    // keyed by the user's runtime ORS key when set, else the VITE_ORS_API_KEY fallback.
    return {
      weather: new FmiWeatherProvider({ fallback: new OpenMeteoProvider() }),
      routing: new OrsRouteProvider({ apiKey: runtimeKey('ors') }),
    };
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
let transitKeySnapshot: string | undefined;
export function getTransitProvider(): TransitProvider {
  // Keyless (throws 'no-key' → wind-only ranking) when live APIs are off, so a stale key in .env
  // can't fire real calls in mock mode. Live: a singleton, so its cache survives repeated plans —
  // rebuilt only when the user's runtime Digitransit key changes (rare).
  if (!liveApisEnabled()) return new DigitransitProvider({ apiKey: '' });
  const key = runtimeKey('digitransit');
  if (!transitSingleton || transitKeySnapshot !== key) {
    transitSingleton = new DigitransitProvider(key ? { apiKey: key } : {});
    transitKeySnapshot = key;
  }
  return transitSingleton;
}
