/**
 * WindRide backend API types (WR-040). The API is the thin Lambda behind the Function URL; the base
 * URL is PUBLIC config (VITE_API_URL). Auth is a Cognito JWT in the Authorization header — the API
 * never sees any BYO key (DEC-040).
 */

export interface Profile {
  userId: string;
  email: string;
  /** Subscription tier — only 'free' for now (WR-040). */
  entitlement: string;
  createdAt: string;
}

export interface ApiClient {
  /** GET /me — the caller's profile + entitlement (created on first call). Needs a valid id token. */
  getMe(idToken: string): Promise<Profile>;
}
