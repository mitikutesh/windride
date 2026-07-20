/**
 * data/exposureGrid.ts — load + look up the offline wind-exposure grid (WR-018, SCORING_SPEC §2,
 * DEC-006). The grid is a static JSON built once by tools/exposure_grid/ from the Uusimaa OSM
 * extract; the app reads it locally (no runtime Overpass, no quota). exposureAt is O(1).
 *
 * Factors are quantised to one byte per cell and base64-packed row-major from the SW origin, so the
 * whole Uusimaa grid stays well under the 5 MB budget. Out-of-region lookups return 1.0 (neutral)
 * with inRegion:false, and a missing asset degrades to a null grid (all lookups neutral) so the app
 * runs before the grid is generated.
 */

/** On-disk grid format (mirrors the Python writer). */
export interface ExposureGridFile {
  version: number;
  /** SW corner (minimum lat/lon). */
  origin: { lat: number; lon: number };
  /** Degrees per cell northward / eastward. */
  dLat: number;
  dLon: number;
  cols: number;
  rows: number;
  cellSizeM: number;
  /** Byte 0..255 maps linearly onto [min, max]. */
  quant: { min: number; max: number };
  /** rows*cols bytes, row-major from the origin (row 0 = southmost), base64-encoded. */
  factorsB64: string;
}

export interface DecodedGrid {
  origin: { lat: number; lon: number };
  dLat: number;
  dLon: number;
  cols: number;
  rows: number;
  cellSizeM: number;
  quant: { min: number; max: number };
  bytes: Uint8Array;
}

export interface ExposureLookup {
  /** Exposure factor 0.35..1.15 (1.0 when out of region). */
  factor: number;
  inRegion: boolean;
}

const NEUTRAL: ExposureLookup = { factor: 1.0, inRegion: false };

function base64ToBytes(b64: string): Uint8Array {
  // atob exists in browsers and Node >= 16; keeps the decoder dependency-free.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeExposureGrid(file: ExposureGridFile): DecodedGrid {
  const bytes = base64ToBytes(file.factorsB64);
  const expected = file.rows * file.cols;
  if (bytes.length !== expected) {
    throw new Error(`exposureGrid: ${bytes.length} bytes but rows*cols = ${expected}`);
  }
  return {
    origin: file.origin,
    dLat: file.dLat,
    dLon: file.dLon,
    cols: file.cols,
    rows: file.rows,
    cellSizeM: file.cellSizeM,
    quant: file.quant,
    bytes,
  };
}

/** O(1) exposure lookup. Out-of-region ⇒ neutral 1.0 with inRegion:false. */
export function exposureAt(grid: DecodedGrid | null, lat: number, lon: number): ExposureLookup {
  if (!grid) return NEUTRAL;
  const row = Math.floor((lat - grid.origin.lat) / grid.dLat);
  const col = Math.floor((lon - grid.origin.lon) / grid.dLon);
  if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) return NEUTRAL;
  const byte = grid.bytes[row * grid.cols + col];
  const { min, max } = grid.quant;
  return { factor: min + (byte / 255) * (max - min), inRegion: true };
}

/**
 * Load the exposure grid asset. Returns null if it hasn't been generated yet (tools/exposure_grid/
 * not run) or the fetch fails — callers then treat every cell as neutral exposure.
 */
export async function loadExposureGrid(
  fetchFn: typeof fetch = fetch,
  // BASE_URL-relative so this same-origin fetch resolves under a subpath deploy (e.g. /windride/),
  // not just the site root — Vite can't rewrite a runtime fetch string like it does asset URLs.
  url = `${import.meta.env.BASE_URL}data/exposure-uusimaa.json`,
): Promise<DecodedGrid | null> {
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch {
    return null; // offline / no asset — neutral exposure everywhere
  }
  if (!res.ok) return null; // 404: grid not generated yet
  try {
    return decodeExposureGrid((await res.json()) as ExposureGridFile);
  } catch (e) {
    // A present-but-corrupt grid is a real bug (bad manual run) — warn rather than silently neutral.
    console.warn('exposureGrid: failed to decode grid asset, using neutral exposure', e);
    return null;
  }
}
