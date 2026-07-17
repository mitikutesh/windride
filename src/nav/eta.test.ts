import { describe, expect, it } from 'vitest';
import { EtaEstimator } from './eta';

describe('EtaEstimator', () => {
  it('trusts the model until it has data (ratio 1)', () => {
    const e = new EtaEstimator();
    expect(e.speedRatio).toBe(1);
    expect(e.correct(600)).toBe(600);
  });

  it('shrinks the ETA when riding faster than modelled', () => {
    const e = new EtaEstimator();
    for (let i = 0; i < 20; i++) e.update(8, 5); // actual 8 m/s vs modelled 5
    expect(e.speedRatio).toBeGreaterThan(1);
    expect(e.correct(600)).toBeLessThan(600);
  });

  it('grows the ETA when riding slower than modelled', () => {
    const e = new EtaEstimator();
    for (let i = 0; i < 20; i++) e.update(3, 5);
    expect(e.speedRatio).toBeLessThan(1);
    expect(e.correct(600)).toBeGreaterThan(600);
  });

  it('applies the EMA weighting (alpha) to a single sample', () => {
    const e = new EtaEstimator(0.1);
    e.update(10, 5); // sample ratio 2 -> 0.1*2 + 0.9*1
    expect(e.speedRatio).toBeCloseTo(1.1, 6);
  });

  it('ignores non-positive modelled speed', () => {
    const e = new EtaEstimator();
    e.update(8, 0);
    e.update(8, -1);
    expect(e.speedRatio).toBe(1);
  });
});
