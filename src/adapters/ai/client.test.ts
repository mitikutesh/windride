import { afterEach, describe, expect, it } from 'vitest';
import anthropicFixture from '../../../fixtures/ai/anthropic-response.json';
import geminiFixture from '../../../fixtures/ai/gemini-response.json';
import openrouterFixture from '../../../fixtures/ai/openrouter-response.json';
import { isProviderError } from '../errors';
import { aiReady, getAiClient, setRuntimeConfig } from '../registry';
import { AiHttpClient } from './client';
import type { AiProvider } from './types';

interface FakeCall {
  url: string;
  init: RequestInit;
}
interface FakeOpts {
  status?: number;
  body?: unknown;
  throwErr?: boolean;
}

/** A duck-typed fetch that records calls and returns the fields the client reads (status/ok/json). */
function fakeFetch(opts: FakeOpts) {
  const calls: FakeCall[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (opts.throwErr) throw new TypeError('network down');
    const status = opts.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => opts.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

/** The per-feature validator every real feature supplies: shape-checks, returns null to reject. */
function okParse(raw: unknown): { ok: true; n: number } | null {
  const o = raw as { ok?: unknown; n?: unknown } | null;
  return o && o.ok === true && typeof o.n === 'number' ? { ok: true, n: o.n } : null;
}

const REQ = { system: 'be helpful', prompt: 'the data' };

const PROVIDERS: Array<{ p: AiProvider; body: unknown; host: string }> = [
  { p: 'anthropic', body: anthropicFixture, host: 'api.anthropic.com' },
  { p: 'openrouter', body: openrouterFixture, host: 'openrouter.ai' },
  { p: 'gemini', body: geminiFixture, host: 'generativelanguage.googleapis.com' },
];

describe('AiHttpClient', () => {
  for (const { p, body, host } of PROVIDERS) {
    it(`${p}: parses a valid structured response and posts to the right endpoint`, async () => {
      const { fn, calls } = fakeFetch({ body });
      const client = new AiHttpClient({ provider: p, apiKey: 'sk-x', fetchFn: fn });
      const out = await client.complete(REQ, okParse);
      expect(out).toEqual({ ok: true, n: 42 });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain(host);
      expect(calls[0].init.method).toBe('POST');
    });
  }

  it('anthropic sends x-api-key + the browser-access opt-in header', async () => {
    const { fn, calls } = fakeFetch({ body: anthropicFixture });
    await new AiHttpClient({ provider: 'anthropic', apiKey: 'sk-a', fetchFn: fn }).complete(
      REQ,
      okParse,
    );
    const h = calls[0].init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-a');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('openrouter sends a Bearer token', async () => {
    const { fn, calls } = fakeFetch({ body: openrouterFixture });
    await new AiHttpClient({ provider: 'openrouter', apiKey: 'sk-o', fetchFn: fn }).complete(
      REQ,
      okParse,
    );
    const h = calls[0].init.headers as Record<string, string>;
    expect(h['authorization']).toBe('Bearer sk-o');
  });

  it('gemini carries the key in a header, never in the URL', async () => {
    const { fn, calls } = fakeFetch({ body: geminiFixture });
    await new AiHttpClient({ provider: 'gemini', apiKey: 'sk-g', fetchFn: fn }).complete(
      REQ,
      okParse,
    );
    const h = calls[0].init.headers as Record<string, string>;
    expect(h['x-goog-api-key']).toBe('sk-g');
    expect(calls[0].url).not.toContain('sk-g'); // key must not leak into any URL-logging surface
  });

  it('anthropic skips a leading non-text (thinking) block', async () => {
    const body = {
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: '{"ok":true,"n":5}' },
      ],
    };
    const { fn } = fakeFetch({ body });
    const client = new AiHttpClient({ provider: 'anthropic', apiKey: 'x', fetchFn: fn });
    expect(await client.complete(REQ, okParse)).toEqual({ ok: true, n: 5 });
  });

  it('treats a validator that THROWS as a rejection, not a raw error', async () => {
    const { fn } = fakeFetch({ body: anthropicFixture });
    const client = new AiHttpClient({ provider: 'anthropic', apiKey: 'x', fetchFn: fn });
    await expect(
      client.complete(REQ, () => {
        throw new TypeError('validator blew up');
      }),
    ).rejects.toMatchObject({ kind: 'badResponse' });
  });

  it('drops malformed output as a badResponse — never partial-trusts', async () => {
    const { fn } = fakeFetch({ body: { content: [{ text: 'not json at all' }] } });
    const client = new AiHttpClient({ provider: 'anthropic', apiKey: 'x', fetchFn: fn });
    await expect(client.complete(REQ, okParse)).rejects.toMatchObject({ kind: 'badResponse' });
  });

  it('treats a validator rejection (parse → null) as a badResponse', async () => {
    const { fn } = fakeFetch({ body: anthropicFixture });
    const client = new AiHttpClient({ provider: 'anthropic', apiKey: 'x', fetchFn: fn });
    await expect(client.complete(REQ, () => null)).rejects.toMatchObject({ kind: 'badResponse' });
  });

  it('maps HTTP + transport failures to the right ProviderError kinds', async () => {
    const mk = (o: FakeOpts) =>
      new AiHttpClient({ provider: 'openrouter', apiKey: 'x', fetchFn: fakeFetch(o).fn });
    await expect(mk({ status: 429, body: {} }).complete(REQ, okParse)).rejects.toMatchObject({
      kind: 'quota',
    });
    await expect(mk({ status: 401, body: {} }).complete(REQ, okParse)).rejects.toMatchObject({
      kind: 'badResponse',
      code: 'auth',
    });
    await expect(mk({ status: 500, body: {} }).complete(REQ, okParse)).rejects.toMatchObject({
      kind: 'badResponse',
    });
    const netErr = await mk({ throwErr: true })
      .complete(REQ, okParse)
      .catch((e) => e);
    expect(isProviderError(netErr) && netErr.kind).toBe('network');
  });

  it('tolerates a ```json fence around the JSON', async () => {
    const { fn } = fakeFetch({ body: { content: [{ text: '```json\n{"ok":true,"n":7}\n```' }] } });
    const client = new AiHttpClient({ provider: 'anthropic', apiKey: 'x', fetchFn: fn });
    expect(await client.complete(REQ, okParse)).toEqual({ ok: true, n: 7 });
  });
});

describe('registry AI gating (getAiClient / aiReady)', () => {
  afterEach(() => setRuntimeConfig({ keys: {}, liveApis: null, aiProvider: null }));

  it('needs BOTH a key and a provider before AI is usable', () => {
    setRuntimeConfig({ keys: {}, liveApis: null, aiProvider: null });
    expect(getAiClient()).toBeNull();
    expect(aiReady()).toBe(false);

    setRuntimeConfig({ keys: { ai: 'sk' }, liveApis: null, aiProvider: null });
    expect(getAiClient()).toBeNull(); // provider not chosen

    setRuntimeConfig({ keys: {}, liveApis: null, aiProvider: 'gemini' });
    expect(getAiClient()).toBeNull(); // key not set

    setRuntimeConfig({ keys: { ai: 'sk' }, liveApis: null, aiProvider: 'anthropic' });
    expect(aiReady()).toBe(true);
    expect(getAiClient()?.provider).toBe('anthropic');
  });
});
