/**
 * adapters/strava/upload.ts — upload-only Strava integration (WR-023). By Strava ToS + CLAUDE.md
 * this NEVER reads athlete/activity/segment data — Strava data must not enter scoring or any ML/AI
 * path. The only endpoints touched are POST /oauth/token (refresh), POST /uploads (push GPX), and
 * GET /uploads/{id} (poll the upload's own status for the resulting activity id — part of the write
 * flow, not a data read; DEC-027). fetch/clock are injectable so tests run fully mocked.
 */
import { ProviderError } from '../errors';

const STRAVA_BASE = 'https://www.strava.com/api/v3';
const OAUTH_URL = 'https://www.strava.com/oauth/token';

/** Owner credentials — from the local tools config / idb, NEVER bundled in Vite env. */
export interface StravaCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface StravaUploadResult {
  activityId: number;
}

export interface StravaDeps {
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Delay between status polls (injectable; tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
  oauthUrl?: string;
  maxPolls?: number;
}

interface Session {
  accessToken: string;
  expiresAt: number; // epoch ms
}

const EXPIRY_SKEW_MS = 60_000; // refresh a minute early

export class StravaUploader {
  private session: Session | null = null;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly base: string;
  private readonly oauth: string;
  private readonly maxPolls: number;

  constructor(
    private readonly creds: StravaCreds,
    deps: StravaDeps = {},
  ) {
    // Native fetch throws "Illegal invocation" if called as a method of another object, so bind it
    // to the global (as fmi.ts / digitransit.ts do). Only reproducible in a real browser — unit
    // tests inject fetchFn, so this needs the WR-023 manual E2E to catch.
    this.fetchFn = deps.fetchFn ?? fetch.bind(globalThis);
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.base = deps.baseUrl ?? STRAVA_BASE;
    this.oauth = deps.oauthUrl ?? OAUTH_URL;
    this.maxPolls = deps.maxPolls ?? 12;
  }

  /** Valid access token, refreshing via the refresh token when the cached one is missing/expiring. */
  async accessToken(): Promise<string> {
    if (this.session && this.session.expiresAt - EXPIRY_SKEW_MS > this.now()) {
      return this.session.accessToken;
    }
    const body = new URLSearchParams({
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: this.creds.refreshToken,
    });
    const res = await this.fetchOrNetwork(this.oauth, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw this.httpError(res.status, 'token refresh', 'auth');
    const json = (await res.json()) as { access_token: string; expires_at: number };
    this.session = { accessToken: json.access_token, expiresAt: json.expires_at * 1000 };
    return this.session.accessToken;
  }

  /** Upload a GPX; returns the upload id to poll. externalId makes re-sends idempotent (dedupe). */
  async startUpload(gpx: string, name: string, externalId: string): Promise<number> {
    const token = await this.accessToken();
    const form = new FormData();
    form.append('data_type', 'gpx');
    form.append('name', name);
    form.append('external_id', externalId);
    form.append('file', new Blob([gpx], { type: 'application/gpx+xml' }), `${externalId}.gpx`);
    const res = await this.fetchOrNetwork(`${this.base}/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as { id?: number; error?: string | null };
    if (!res.ok || json.error) {
      if (res.status === 429) throw new ProviderError('quota', 'Strava rate limit', 'rate');
      if (/duplicate/i.test(json.error ?? '')) {
        throw new ProviderError('badResponse', 'already uploaded', 'duplicate');
      }
      throw this.httpError(res.status, json.error ?? 'upload', 'upload');
    }
    if (typeof json.id !== 'number') {
      throw new ProviderError('badResponse', 'Strava upload returned no id', 'upload');
    }
    return json.id;
  }

  /** Poll the upload's own status until it yields an activity id or errors. GET /uploads/{id} only. */
  async pollUpload(uploadId: number): Promise<StravaUploadResult> {
    const token = await this.accessToken();
    for (let i = 0; i < this.maxPolls; i++) {
      const res = await this.fetchOrNetwork(`${this.base}/uploads/${uploadId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Map HTTP failures here too (a 401/429 mid-poll must surface, not silently time out).
      if (res.status === 429) throw new ProviderError('quota', 'Strava rate limit', 'rate');
      if (!res.ok) throw this.httpError(res.status, 'upload status', 'upload');
      const json = (await res.json().catch(() => ({}))) as {
        activity_id: number | null;
        error: string | null;
      };
      if (json.error) {
        if (/duplicate/i.test(json.error)) {
          throw new ProviderError('badResponse', 'already uploaded', 'duplicate');
        }
        throw new ProviderError('badResponse', json.error, 'upload');
      }
      if (json.activity_id) return { activityId: json.activity_id };
      await this.sleep(2000);
    }
    throw new ProviderError('badResponse', 'upload still processing', 'timeout');
  }

  /** Upload + poll to completion. */
  async sendGpx(gpx: string, name: string, externalId: string): Promise<StravaUploadResult> {
    return this.pollUpload(await this.startUpload(gpx, name, externalId));
  }

  private async fetchOrNetwork(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(url, init);
    } catch (e) {
      throw new ProviderError('network', `Strava request failed: ${String(e)}`);
    }
  }

  private httpError(status: number, what: string, code: string): ProviderError {
    if (status === 401 || status === 400)
      return new ProviderError('badResponse', `Strava ${what} auth failed`, 'auth');
    if (status === 429) return new ProviderError('quota', `Strava ${what} rate limited`, 'rate');
    return new ProviderError('badResponse', `Strava ${what} failed (${status})`, code);
  }
}
