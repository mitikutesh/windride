import { describe, expect, it } from 'vitest';
import { isProviderError } from '../errors';
import { DigitransitProvider, parseReturnService } from './digitransit';
import riihimaki from '../../../fixtures/digitransit/riihimaki.json';

const SERVICE_DAY = 1752710400;
const RIIHIMAKI = { lat: 60.7375, lon: 24.7736 };

describe('parseReturnService', () => {
  it('reduces a stopsByRadius response to soonest-first departures + median headway', () => {
    const after = SERVICE_DAY + 66_000; // 18:20 — before the first 18:30 departure
    const svc = parseReturnService(riihimaki, after);
    expect(svc.departuresMs).toHaveLength(4);
    expect(svc.departuresMs[0]).toBe((SERVICE_DAY + 66_600) * 1000);
    // Departures are 30 min apart (the one realtime nudge of 20 s doesn't move the median).
    expect(svc.headwayMin).toBeCloseTo(30, 0);
    // Sorted ascending.
    expect([...svc.departuresMs].sort((a, b) => a - b)).toEqual(svc.departuresMs);
  });

  it('drops departures before the requested time', () => {
    const after = SERVICE_DAY + 69_000; // after the 19:00 departure
    const svc = parseReturnService(riihimaki, after);
    expect(svc.departuresMs).toHaveLength(2); // only 19:30 and 20:00 remain
  });

  it('prefers realtimeDeparture over scheduled when present', () => {
    const after = SERVICE_DAY + 68_000;
    const svc = parseReturnService(riihimaki, after);
    // 2nd stoptime has realtime 68420 (not the scheduled 68400).
    expect(svc.departuresMs).toContain((SERVICE_DAY + 68_420) * 1000);
  });

  it('returns null headway when fewer than two departures are known', () => {
    expect(parseReturnService({ data: { stopsByRadius: { edges: [] } } }, 0).headwayMin).toBeNull();
    expect(parseReturnService({}, 0)).toEqual({ departuresMs: [], headwayMin: null });
  });
});

/** A scripted fetch returning a canned Response. */
function mockFetch(res: {
  ok?: boolean;
  status?: number;
  json?: () => unknown;
  throws?: boolean;
}): typeof fetch {
  return (() => {
    if (res.throws) return Promise.reject(new Error('network down'));
    return Promise.resolve({
      ok: res.ok ?? true,
      status: res.status ?? 200,
      json: () => Promise.resolve(res.json ? res.json() : riihimaki),
    } as Response);
  }) as unknown as typeof fetch;
}

describe('DigitransitProvider', () => {
  const opts = (fetchFn: typeof fetch) => ({ apiKey: 'k', fetchFn });

  it('fetches and parses the next return departures', async () => {
    const p = new DigitransitProvider(opts(mockFetch({})));
    const svc = await p.returnService(RIIHIMAKI, (SERVICE_DAY + 66_000) * 1000);
    expect(svc.departuresMs.length).toBeGreaterThan(0);
    expect(svc.headwayMin).toBeCloseTo(30, 0);
  });

  it('signals a typed no-key error so the planner can degrade to wind-only', async () => {
    const p = new DigitransitProvider({ apiKey: '' });
    expect(p.hasKey).toBe(false);
    await expect(p.returnService(RIIHIMAKI, Date.now())).rejects.toMatchObject({ code: 'no-key' });
  });

  it('maps rate-limit to a quota error', async () => {
    const p = new DigitransitProvider(opts(mockFetch({ ok: false, status: 429 })));
    await expect(p.returnService(RIIHIMAKI, Date.now())).rejects.toMatchObject({ kind: 'quota' });
  });

  it('maps other non-OK statuses to badResponse', async () => {
    const p = new DigitransitProvider(opts(mockFetch({ ok: false, status: 500 })));
    await expect(p.returnService(RIIHIMAKI, Date.now())).rejects.toMatchObject({
      kind: 'badResponse',
    });
  });

  it('maps a fetch failure to a network error', async () => {
    const p = new DigitransitProvider(opts(mockFetch({ throws: true })));
    const err = await p.returnService(RIIHIMAKI, Date.now()).catch((e) => e);
    expect(isProviderError(err) && err.kind).toBe('network');
  });
});
