/**
 * adapters/api/client.ts — the WindRide backend client (WR-040). Plain fetch to the Lambda Function
 * URL, attaching the Cognito id token as a Bearer header. One of the few places fetch() may appear
 * (CLAUDE.md rule 4). Base URL is PUBLIC config (VITE_API_URL). No BYO key ever goes to the backend.
 */
import { ProviderError } from '../errors';
import type { ApiClient, Profile } from './types';

/** True when the build knows where the backend lives (VITE_API_URL set). */
export function apiConfigured(): boolean {
  return Boolean(import.meta.env.VITE_API_URL);
}

export interface ApiOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export class HttpApiClient implements ApiClient {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: ApiOptions = {}) {
    this.base = (opts.baseUrl ?? import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
  }

  async getMe(idToken: string): Promise<Profile> {
    if (!this.base) throw new ProviderError('badResponse', 'Backend not configured', 'no-config');
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}/me`, {
        headers: { authorization: `Bearer ${idToken}` },
      });
    } catch {
      throw new ProviderError('network', 'Backend request failed');
    }
    if (res.status === 401) throw new ProviderError('badResponse', 'Session expired', 'auth');
    if (res.status === 429) throw new ProviderError('quota', 'Rate limited');
    if (!res.ok) throw new ProviderError('badResponse', `Backend HTTP ${res.status}`);
    return (await res.json()) as Profile;
  }
}
