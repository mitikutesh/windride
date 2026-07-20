import { describe, expect, it } from 'vitest';
import { BASEMAPS, DEFAULT_BASEMAP, basemapLayerId, rasterBasemaps } from './basemaps';

describe('basemaps', () => {
  it('offers the vector Streets base + three raster layers, all keyless https', () => {
    expect(BASEMAPS.map((b) => b.id)).toEqual(['streets', 'cycling', 'satellite', 'terrain']);
    expect(DEFAULT_BASEMAP).toBe('streets');
    expect(BASEMAPS.find((b) => b.id === 'streets')?.raster).toBeUndefined(); // no overlay
    for (const b of rasterBasemaps()) {
      expect(b.raster).toBeDefined();
      for (const url of b.raster!.tiles) {
        expect(url.startsWith('https://')).toBe(true);
        expect(url).toContain('{z}');
        expect(url).not.toMatch(/key=|apikey|token|access_token/i); // no API key baked in
      }
      expect(b.raster!.attribution.length).toBeGreaterThan(0); // licence attribution present
    }
  });

  it('satellite uses the Esri {z}/{y}/{x} tile order (row/col, not the usual x/y)', () => {
    const sat = BASEMAPS.find((b) => b.id === 'satellite');
    expect(sat?.raster?.tiles[0]).toContain('{z}/{y}/{x}');
  });

  it('rasterBasemaps excludes the vector Streets base', () => {
    expect(rasterBasemaps().map((b) => b.id)).toEqual(['cycling', 'satellite', 'terrain']);
  });

  it('basemapLayerId is stable + namespaced', () => {
    expect(basemapLayerId('cycling')).toBe('wr-base-cycling');
  });
});
