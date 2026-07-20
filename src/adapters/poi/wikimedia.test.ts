import { describe, expect, it } from 'vitest';
import commons from '../../../fixtures/poi/commons-nuuksio.json';
import { isProviderError } from '../errors';
import { parseWikimediaPois, WikimediaPoiProvider } from './wikimedia';

/** A no-op cache so the adapter's unit tests never touch idb. */
const noCache = { get: async () => undefined, set: async () => {} };

describe('parseWikimediaPois', () => {
  it('keeps pages with an https thumbnail, strips File:/extension, coords optional', () => {
    const pois = parseWikimediaPois(commons);
    expect(pois).toHaveLength(2); // the third page has no imageinfo → dropped
    expect(pois[0].title).toBe('Nuuksio lake view');
    expect(pois[0].lat).toBe(60.31);
    expect(pois[1].title).toBe('Forest trail');
    expect(pois[1].lat).toBeNull(); // that page has no coordinates
  });

  it('parses per-image attribution (author HTML stripped) + licence', () => {
    const [first, second] = parseWikimediaPois(commons);
    expect(first.artist).toBe('Jane Doe'); // <a> tags stripped
    expect(first.license).toBe('CC BY-SA 4.0');
    expect(first.licenseUrl).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(second.artist).toBeNull(); // no extmetadata on that page
  });

  it('drops a page whose thumbnail/page URL is missing or non-https (no empty href)', () => {
    const pois = parseWikimediaPois({
      query: {
        pages: {
          '1': null,
          '2': {
            title: 'File:Insecure.jpg',
            imageinfo: [{ thumburl: 'http://x/insecure.jpg', descriptionurl: 'http://x' }],
          },
        },
      },
    });
    expect(pois).toEqual([]);
  });

  it('tolerates a malformed payload', () => {
    expect(parseWikimediaPois({})).toEqual([]);
    expect(parseWikimediaPois(null)).toEqual([]);
    expect(parseWikimediaPois({ query: { pages: {} } })).toEqual([]);
  });
});

function fakeFetch(status: number, body: unknown) {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('WikimediaPoiProvider.nearbyPhotos', () => {
  it('builds a keyless geosearch URL and parses the response', async () => {
    const { fn, calls } = fakeFetch(200, commons);
    const pois = await new WikimediaPoiProvider({ fetchFn: fn, cache: noCache }).nearbyPhotos(
      { lat: 60.3, lon: 24.5 },
      1500,
      5,
    );
    expect(pois).toHaveLength(2);
    expect(calls[0]).toContain('generator=geosearch');
    expect(calls[0]).toContain('origin=*'); // anonymous CORS, no key
    expect(calls[0]).toContain('ggscoord=60.3%7C24.5');
  });

  it('maps HTTP errors to ProviderError kinds', async () => {
    const { fn } = fakeFetch(429, {});
    const err = await new WikimediaPoiProvider({ fetchFn: fn, cache: noCache })
      .nearbyPhotos({ lat: 60, lon: 24 }, 1500, 5)
      .catch((e) => e);
    expect(isProviderError(err) && err.kind).toBe('quota');
  });
});
