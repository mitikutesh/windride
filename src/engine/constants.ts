/**
 * Shared engine constants (pure, no I/O).
 *
 * Segment resampling targets come straight from SCORING_SPEC §1: resample candidate
 * polylines to 200–500 m segments, aiming for ~300 m. WR-006 consumes these.
 */
export const SEGMENT_TARGET_M = 300;
export const SEGMENT_MIN_M = 200;
export const SEGMENT_MAX_M = 500;
