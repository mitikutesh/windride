import { describe, expect, it } from 'vitest';
import {
  decodeExposureGrid,
  exposureAt,
  loadExposureGrid,
  type ExposureGridFile,
} from './exposureGrid';

// A 2-row × 3-col handcrafted grid, row-major from the SW origin (row 0 = southmost).
//   row 0 (south): 0, 128, 255
//   row 1 (north): 64, 191, 100
const BYTES = new Uint8Array([0, 128, 255, 64, 191, 100]);
const file: ExposureGridFile = {
  version: 1,
  origin: { lat: 60, lon: 24 },
  dLat: 0.002,
  dLon: 0.004,
  cols: 3,
  rows: 2,
  cellSizeM: 250,
  quant: { min: 0.35, max: 1.15 },
  factorsB64: btoa(String.fromCharCode(...BYTES)),
};

const byteToFactor = (b: number) => 0.35 + (b / 255) * 0.8;

describe('decodeExposureGrid', () => {
  it('decodes the packed bytes and preserves the meta', () => {
    const g = decodeExposureGrid(file);
    expect(Array.from(g.bytes)).toEqual([0, 128, 255, 64, 191, 100]);
    expect(g.cols).toBe(3);
    expect(g.rows).toBe(2);
  });

  it('throws when the byte count does not match rows*cols', () => {
    expect(() => decodeExposureGrid({ ...file, cols: 4 })).toThrow(/rows\*cols/);
  });
});

describe('exposureAt', () => {
  const g = decodeExposureGrid(file);

  it('reads the SW-corner cell', () => {
    expect(exposureAt(g, 60.001, 24.001)).toEqual({ factor: byteToFactor(0), inRegion: true });
  });

  it('reads a max-exposure cell (row 0, col 2)', () => {
    expect(exposureAt(g, 60.001, 24.009).factor).toBeCloseTo(1.15, 6);
  });

  it('reads a north-row interior cell (row 1, col 1)', () => {
    expect(exposureAt(g, 60.003, 24.005).factor).toBeCloseTo(byteToFactor(191), 6);
  });

  it('returns neutral 1.0 out of region (west, and north of the grid)', () => {
    expect(exposureAt(g, 60.001, 23.999)).toEqual({ factor: 1.0, inRegion: false });
    expect(exposureAt(g, 60.05, 24.005)).toEqual({ factor: 1.0, inRegion: false });
  });

  it('returns neutral 1.0 for a null grid (asset not generated)', () => {
    expect(exposureAt(null, 60.001, 24.001)).toEqual({ factor: 1.0, inRegion: false });
  });
});

describe('loadExposureGrid', () => {
  it('decodes a fetched grid', async () => {
    const fetchFn = (() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(file) })) as unknown as typeof fetch;
    const g = await loadExposureGrid(fetchFn);
    expect(g?.cols).toBe(3);
  });

  it('returns null when the asset is missing (404) or fetch throws', async () => {
    const notFound = (() => Promise.resolve({ ok: false })) as unknown as typeof fetch;
    const throws = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    expect(await loadExposureGrid(notFound)).toBeNull();
    expect(await loadExposureGrid(throws)).toBeNull();
  });
});
