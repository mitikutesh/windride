import { describe, expect, it } from 'vitest';
import { isProviderError } from '../errors';
import { StravaUploader, type StravaDeps } from './upload';

const CREDS = { clientId: '1', clientSecret: 'secret', refreshToken: 'refresh' };

interface Call {
  url: string;
  method: string;
}

/** A scripted fetch: matches by URL substring, records every call. */
function mockFetch(
  handlers: Array<{
    match: (url: string, method: string) => boolean;
    res: () => unknown;
    ok?: boolean;
    status?: number;
  }>,
) {
  const calls: Call[] = [];
  const fetchFn = ((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    const h = handlers.find((x) => x.match(url, method));
    if (!h) return Promise.reject(new Error(`no handler for ${method} ${url}`));
    return Promise.resolve({
      ok: h.ok ?? true,
      status: h.status ?? 200,
      json: () => Promise.resolve(h.res()),
    } as Response);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const NOW = 1_000_000_000_000;
const baseDeps = (fetchFn: typeof fetch): StravaDeps => ({
  fetchFn,
  now: () => NOW,
  sleep: () => Promise.resolve(),
});

const okToken = () => ({ access_token: 'tok', expires_at: NOW / 1000 + 3600 });

describe('StravaUploader', () => {
  it('refreshes the access token once and caches it until expiry', async () => {
    const { fetchFn, calls } = mockFetch([
      { match: (u) => u.includes('/oauth/token'), res: okToken },
    ]);
    const up = new StravaUploader(CREDS, baseDeps(fetchFn));
    expect(await up.accessToken()).toBe('tok');
    await up.accessToken(); // cached — no second refresh
    expect(calls.filter((c) => c.url.includes('/oauth/token'))).toHaveLength(1);
  });

  it('uploads a GPX and polls until an activity id appears', async () => {
    let polls = 0;
    const { fetchFn, calls } = mockFetch([
      { match: (u) => u.includes('/oauth/token'), res: okToken },
      { match: (u, m) => u.endsWith('/uploads') && m === 'POST', res: () => ({ id: 99 }) },
      {
        match: (u) => /\/uploads\/99$/.test(u),
        res: () =>
          polls++ === 0 ? { activity_id: null, error: null } : { activity_id: 12345, error: null },
      },
    ]);
    const up = new StravaUploader(CREDS, baseDeps(fetchFn));
    expect(await up.sendGpx('<gpx/>', 'Ride', 'ride-1')).toEqual({ activityId: 12345 });
    // No data reads: every GET is the upload-status endpoint, nothing else.
    const gets = calls.filter((c) => c.method === 'GET');
    expect(gets.length).toBeGreaterThan(0);
    expect(gets.every((c) => /\/uploads\/\d+$/.test(c.url))).toBe(true);
    expect(calls.some((c) => /\/(athlete|activities|segments)/.test(c.url))).toBe(false);
  });

  it('maps a duplicate upload to a typed duplicate error (idempotent re-send)', async () => {
    const { fetchFn } = mockFetch([
      { match: (u) => u.includes('/oauth/token'), res: okToken },
      {
        match: (u, m) => u.endsWith('/uploads') && m === 'POST',
        res: () => ({ error: 'duplicate of activity 5' }),
      },
    ]);
    const up = new StravaUploader(CREDS, baseDeps(fetchFn));
    await expect(up.sendGpx('<gpx/>', 'Ride', 'ride-1')).rejects.toMatchObject({
      code: 'duplicate',
    });
  });

  it('maps an auth failure on refresh', async () => {
    const { fetchFn } = mockFetch([
      { match: (u) => u.includes('/oauth/token'), res: () => ({}), ok: false, status: 401 },
    ]);
    const up = new StravaUploader(CREDS, baseDeps(fetchFn));
    await expect(up.accessToken()).rejects.toMatchObject({ code: 'auth' });
  });

  it('maps a rate-limit on upload to a quota error', async () => {
    const { fetchFn } = mockFetch([
      { match: (u) => u.includes('/oauth/token'), res: okToken },
      {
        match: (u, m) => u.endsWith('/uploads') && m === 'POST',
        res: () => ({}),
        ok: false,
        status: 429,
      },
    ]);
    const up = new StravaUploader(CREDS, baseDeps(fetchFn));
    await expect(up.startUpload('<gpx/>', 'R', 'ride-1')).rejects.toMatchObject({ kind: 'quota' });
  });

  it('times out after maxPolls when the upload never finishes', async () => {
    const { fetchFn } = mockFetch([
      { match: (u) => u.includes('/oauth/token'), res: okToken },
      { match: (u, m) => u.endsWith('/uploads') && m === 'POST', res: () => ({ id: 3 }) },
      { match: (u) => /\/uploads\/3$/.test(u), res: () => ({ activity_id: null, error: null }) },
    ]);
    const up = new StravaUploader(CREDS, { ...baseDeps(fetchFn), maxPolls: 3 });
    await expect(up.sendGpx('<gpx/>', 'R', 'ride-1')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('re-refreshes the access token after it expires', async () => {
    let clock = NOW;
    const { fetchFn, calls } = mockFetch([
      // Short-lived token (expires 100 s out).
      {
        match: (u) => u.includes('/oauth/token'),
        res: () => ({ access_token: 'tok', expires_at: clock / 1000 + 100 }),
      },
    ]);
    const up = new StravaUploader(CREDS, {
      fetchFn,
      now: () => clock,
      sleep: () => Promise.resolve(),
    });
    await up.accessToken();
    clock += 90_000; // past expiresAt − 60 s skew ⇒ must refresh again
    await up.accessToken();
    expect(calls.filter((c) => c.url.includes('/oauth/token'))).toHaveLength(2);
  });

  it('surfaces a processing error from the poll', async () => {
    const { fetchFn } = mockFetch([
      { match: (u) => u.includes('/oauth/token'), res: okToken },
      { match: (u, m) => u.endsWith('/uploads') && m === 'POST', res: () => ({ id: 7 }) },
      {
        match: (u) => /\/uploads\/7$/.test(u),
        res: () => ({ activity_id: null, error: 'Not a valid GPX' }),
      },
    ]);
    const up = new StravaUploader(CREDS, baseDeps(fetchFn));
    const err = await up.sendGpx('<gpx/>', 'R', 'ride-1').catch((e) => e);
    expect(isProviderError(err)).toBe(true);
  });
});
