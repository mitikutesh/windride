/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** openrouteservice API key — live routing only (see docs/API_NOTES.md §6). */
  readonly VITE_ORS_API_KEY?: string;
  /** Strava client id — upload only (Epic 3). */
  readonly VITE_STRAVA_CLIENT_ID?: string;
  /** Master switch for live API calls. Must be false in tests/CI (CLAUDE.md rule 3). */
  readonly VITE_LIVE_APIS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
