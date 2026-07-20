import { describe, expect, it } from 'vitest';
import { isProviderError } from '../errors';
import { HttpApiClient } from './client';

function fakeFetch(opts: { status?: number; body?: unknown; throwErr?: boolean }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (opts.throwErr) throw new TypeError('offline');
    const status = opts.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => opts.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const PROFILE = { userId: 'u1', email: 'a@b.co', entitlement: 'free', createdAt: '2026' };

describe('HttpApiClient.getMe', () => {
  it('GETs /me with the id token as a Bearer header', async () => {
    const { fn, calls } = fakeFetch({ body: PROFILE });
    const client = new HttpApiClient({ baseUrl: 'https://api.example.com', fetchFn: fn });
    const p = await client.getMe('tok123');
    expect(p.entitlement).toBe('free');
    expect(calls[0].url).toBe('https://api.example.com/me');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok123');
  });

  it('maps 401 to an auth ProviderError', async () => {
    const err = await new HttpApiClient({
      baseUrl: 'https://x',
      fetchFn: fakeFetch({ status: 401, body: {} }).fn,
    })
      .getMe('t')
      .catch((e) => e);
    expect(isProviderError(err) && err.code).toBe('auth');
  });

  it('errors clearly when the backend URL is not configured', async () => {
    const err = await new HttpApiClient({ baseUrl: '' }).getMe('t').catch((e) => e);
    expect(isProviderError(err) && err.code).toBe('no-config');
  });

  it('getSync GETs /sync; putSync PUTs /sync with a {doc} body + JSON content-type', async () => {
    const get = fakeFetch({ body: { doc: { savedRoutes: [] }, updatedAt: 't' } });
    await new HttpApiClient({ baseUrl: 'https://x', fetchFn: get.fn }).getSync('tok');
    expect(get.calls[0].url).toBe('https://x/sync');

    const put = fakeFetch({ body: { updatedAt: 't2' } });
    await new HttpApiClient({ baseUrl: 'https://x', fetchFn: put.fn }).putSync('tok', {
      savedRoutes: [],
    });
    expect(put.calls[0].init.method).toBe('PUT');
    expect(JSON.parse(put.calls[0].init.body as string).doc).toEqual({ savedRoutes: [] });
    expect((put.calls[0].init.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
  });

  it('maps a network throw to a network error', async () => {
    const err = await new HttpApiClient({
      baseUrl: 'https://x',
      fetchFn: fakeFetch({ throwErr: true }).fn,
    })
      .getMe('t')
      .catch((e) => e);
    expect(isProviderError(err) && err.kind).toBe('network');
  });
});
