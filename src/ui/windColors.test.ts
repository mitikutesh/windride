import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_COLORS, WIND_COLORS } from './windColors';

const css = readFileSync('src/ui/tokens.css', 'utf8');
function tokenHex(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token --${name} not found`);
  return m[1].toLowerCase();
}

describe('windColors mirror (WR-009 technical note)', () => {
  it('exactly mirrors the four semantic wind hues in tokens.css', () => {
    expect(WIND_COLORS.tail).toBe(tokenHex('tail'));
    expect(WIND_COLORS.cross).toBe(tokenHex('cross'));
    expect(WIND_COLORS.head).toBe(tokenHex('head'));
    expect(WIND_COLORS.shelter).toBe(tokenHex('shelter'));
  });

  it('mirrors the map-chrome colours (ghost = --text2, start = --sky)', () => {
    expect(MAP_COLORS.ghost).toBe(tokenHex('text2'));
    expect(MAP_COLORS.start).toBe(tokenHex('sky'));
  });
});
