import { describe, expect, it } from 'vitest';
import {
  compass8,
  formatDurationHM,
  metresToKm,
  msToKmh,
  timeOfDay,
  windArrowRotationDeg,
} from './units';

describe('windArrowRotationDeg (arrow points where wind blows TO)', () => {
  it('rotates a from-SW wind to point NE (45°)', () => {
    expect(windArrowRotationDeg(225)).toBe(45);
  });
  it('rotates a from-N wind to point S (180°)', () => {
    expect(windArrowRotationDeg(0)).toBe(180);
  });
  it('wraps past 360', () => {
    expect(windArrowRotationDeg(200)).toBe(20);
  });
});

describe('compass8', () => {
  it('labels cardinal and intercardinal bearings', () => {
    expect(compass8(0)).toBe('N');
    expect(compass8(45)).toBe('NE');
    expect(compass8(225)).toBe('SW');
    expect(compass8(359)).toBe('N');
  });
});

describe('formatters', () => {
  it('converts units at the edge', () => {
    expect(metresToKm(51840)).toBe('51.8');
    expect(msToKmh(10)).toBe('36');
    expect(formatDurationHM(8040)).toBe('2:14');
    expect(timeOfDay('2026-07-17T22:27')).toBe('22:27');
  });
});
