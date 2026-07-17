import { describe, expect, it } from 'vitest';
import { ringGeometry } from './ring';

describe('ringGeometry', () => {
  const size = 100;
  const stroke = 10;
  const circ = 2 * Math.PI * ((size - stroke) / 2);

  it('is empty at score 0 (dashOffset === circumference)', () => {
    const g = ringGeometry(0, size, stroke);
    expect(g.score).toBe(0);
    expect(g.dashOffset).toBeCloseTo(circ);
    expect(g.dashArray).toBeCloseTo(circ);
    expect(g.center).toBe(50);
  });

  it('is half-filled at score 50', () => {
    const g = ringGeometry(50, size, stroke);
    expect(g.dashOffset).toBeCloseTo(circ / 2);
  });

  it('is full at score 100 (dashOffset === 0)', () => {
    const g = ringGeometry(100, size, stroke);
    expect(g.score).toBe(100);
    expect(g.dashOffset).toBeCloseTo(0);
  });

  it('clamps out-of-range scores', () => {
    expect(ringGeometry(150, size, stroke).score).toBe(100);
    expect(ringGeometry(150, size, stroke).dashOffset).toBeCloseTo(0);
    expect(ringGeometry(-10, size, stroke).score).toBe(0);
    expect(ringGeometry(-10, size, stroke).dashOffset).toBeCloseTo(circ);
  });
});
