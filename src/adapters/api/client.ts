/**
 * adapters/api/client.ts — the WindRide backend client (WR-040). Plain fetch to the Lambda Function
 * URL, attaching the Cognito id token as a Bearer header. One of the few places fetch() may appear
 * (CLAUDE.md rule 4). Base URL is PUBLIC config (VITE_API_URL). No BYO key ever goes to the backend.
 */
import { ProviderError } from '../errors';
import type { ApiClient, Profile, SyncPull } from './types';

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

  private async call(path: string, idToken: string, init: RequestInit = {}): Promise<unknown> {
    if (!this.base) throw new ProviderError('badResponse', 'Backend not configured', 'no-config');
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${idToken}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new ProviderError('network', 'Backend request failed');
    }
    if (res.status === 401) throw new ProviderError('badResponse', 'Session expired', 'auth');
    if (res.status === 429) throw new ProviderError('quota', 'Rate limited');
    if (!res.ok) throw new ProviderError('badResponse', `Backend HTTP ${res.status}`);
    return res.json();
  }

  async getMe(idToken: string): Promise<Profile> {
    return (await this.call('/me', idToken)) as Profile;
  }

  async getSync(idToken: string): Promise<SyncPull> {
    return (await this.call('/sync', idToken)) as SyncPull;
  }

  async putSync(idToken: string, doc: unknown): Promise<{ updatedAt: string }> {
    return (await this.call('/sync', idToken, {
      method: 'PUT',
      body: JSON.stringify({ doc }),
    })) as { updatedAt: string };
  }

  async exportData(idToken: string): Promise<unknown> {
    return this.call('/export', idToken);
  }

  async deleteAccount(idToken: string): Promise<{ deleted: number }> {
    return (await this.call('/me', idToken, { method: 'DELETE' })) as { deleted: number };
  }
}
