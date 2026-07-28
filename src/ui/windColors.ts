/**
 * ui/windColors.ts — JS mirror of the semantic wind hues (WR-009).
 *
 * MapLibre paints on a WebGL canvas and cannot read CSS custom properties, so it needs concrete
 * colour strings. This is the ONE sanctioned place (besides tokens.css) allowed to hold raw hex
 * (scripts/check-tokens.mjs whitelists it); windColors.test.ts asserts these equal tokens.css.
 */
import type { WindKind } from './components/ribbon';

export const WIND_COLORS: Record<WindKind, string> = {
  tail: '#2ee6a8',
  cross: '#f5b84c',
  head: '#f26d5b',
  shelter: '#3e8763',
};

/** Map chrome colours (mirrored from tokens.css: ghost=--text2, start=--sky, arrow=--text,
 *  arrowHalo=--bg). windColors.test.ts keeps these in sync. */
export const MAP_COLORS = {
  ghost: '#a9b8a3',
  start: '#bff04d',
  arrow: '#f1f5ec',
  arrowHalo: '#0e120d',
};

export function windColor(kind: WindKind): string {
  return WIND_COLORS[kind];
}
