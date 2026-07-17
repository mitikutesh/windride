/**
 * nav/recorder.ts — ride recorder contract (WR-016 stub; WR-017 implements the crash-safe idb one).
 * The Ride screen depends only on this interface, so start/pause/end wiring lands now and the real
 * recorder drops in without touching the screen.
 */
import type { Fix } from './fixSource';

export interface RideRecorder {
  start(): void;
  addFix(fix: Fix): void;
  pause(): void;
  resume(): void;
  /** Finish and return the recorded GPX (WR-017); the stub returns an empty string. */
  finish(): Promise<string>;
}

/** No-op recorder used until WR-017 lands — keeps the Ride screen wiring exercised. */
export const nullRecorder: RideRecorder = {
  start: () => {},
  addFix: () => {},
  pause: () => {},
  resume: () => {},
  finish: () => Promise.resolve(''),
};
