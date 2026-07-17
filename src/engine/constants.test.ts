import { describe, expect, it } from 'vitest';
import { SEGMENT_MAX_M, SEGMENT_MIN_M, SEGMENT_TARGET_M } from './constants';

// Trivial scaffold test (WR-001): proves Vitest runs the engine layer with no live I/O.
describe('engine segment constants', () => {
  it('keeps the resample target inside the SCORING_SPEC §1 window', () => {
    expect(SEGMENT_TARGET_M).toBeGreaterThanOrEqual(SEGMENT_MIN_M);
    expect(SEGMENT_TARGET_M).toBeLessThanOrEqual(SEGMENT_MAX_M);
  });
});
