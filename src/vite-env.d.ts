/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** openrouteservice API key — live routing only (see docs/API_NOTES.md §6). */
  readonly VITE_ORS_API_KEY?: string;
  // Strava creds are NOT in Vite env (would be bundled) — they live in idb (WR-023, DEC-027).
  /** Digitransit subscription key — downwind return-service ranking only (WR-026). Optional. */
  readonly VITE_DIGITRANSIT_KEY?: string;
  /** Master switch for live API calls. Must be false in tests/CI (CLAUDE.md rule 3). */
  readonly VITE_LIVE_APIS?: string;
  /** Cognito pool region — PUBLIC config (WR-039), safe to bundle. Unset ⇒ accounts off. */
  readonly VITE_COGNITO_REGION?: string;
  /** Cognito public web-client id — PUBLIC config (WR-039), not a secret. Unset ⇒ accounts off. */
  readonly VITE_COGNITO_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
