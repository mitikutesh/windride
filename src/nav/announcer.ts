/**
 * nav/announcer.ts — cue output (WR-014, NAVIGATION_SPEC §4). Turns Cue objects into on-device
 * speech or beeps, with a queue and a 3 s debounce so two cues never overlap or talk over each
 * other. Output ports (speech, beep) and the clock/timer are injectable, so tests assert the
 * utterance log with no real audio and the replay harness drives it deterministically.
 *
 * speechSynthesis / AudioContext need a user gesture on some platforms — call armAudio() on the
 * "Start ride" tap (WR-016) to unlock them.
 */
import type { Cue, CueKind } from './cues';

export type CueMode = 'voice' | 'beep' | 'silent';

export const CUE_DEBOUNCE_MS = 3000;

/** Speaks text (Web Speech in production; mocked in tests). */
export interface SpeechPort {
  speak(text: string): void;
  cancel(): void;
}

/** Plays a short pattern per cue kind (WebAudio in production; mocked in tests). */
export interface BeepPort {
  beep(kind: CueKind): void;
}

type TimerId = ReturnType<typeof setTimeout>;

export interface AnnouncerDeps {
  speech?: SpeechPort;
  beep?: BeepPort;
  now?: () => number;
  setTimeoutFn?: (cb: () => void, ms: number) => TimerId;
  clearTimeoutFn?: (id: TimerId) => void;
  debounceMs?: number;
}

export class Announcer {
  private readonly queue: Cue[] = [];
  private lastDispatchAt = -Infinity;
  private timer: TimerId | undefined;

  private readonly now: () => number;
  private readonly setTimeoutFn: (cb: () => void, ms: number) => TimerId;
  private readonly clearTimeoutFn: (id: TimerId) => void;
  private readonly debounceMs: number;

  constructor(
    private mode: CueMode,
    private readonly deps: AnnouncerDeps = {},
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimeoutFn = deps.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimeoutFn = deps.clearTimeoutFn ?? ((id) => clearTimeout(id));
    this.debounceMs = deps.debounceMs ?? CUE_DEBOUNCE_MS;
  }

  setMode(mode: CueMode): void {
    this.mode = mode;
    if (mode === 'silent') this.stop();
  }

  /** Enqueue a cue for announcement; the queue drains with >= debounce spacing. */
  announce(cue: Cue): void {
    if (this.mode === 'silent') return;
    // Collapse: a fresh cue for the same step supersedes a queued (older) one.
    const dup = this.queue.findIndex((q) => q.stepIndex === cue.stepIndex);
    if (dup >= 0) this.queue.splice(dup, 1);
    this.queue.push(cue);
    this.pump();
  }

  private pump(): void {
    if (this.timer !== undefined || this.queue.length === 0) return;
    const wait = this.debounceMs - (this.now() - this.lastDispatchAt);
    if (wait > 0) {
      this.timer = this.setTimeoutFn(() => {
        this.timer = undefined;
        this.pump();
      }, wait);
      return;
    }
    const cue = this.queue.shift()!;
    this.lastDispatchAt = this.now();
    this.dispatch(cue);
    if (this.queue.length > 0) {
      this.timer = this.setTimeoutFn(() => {
        this.timer = undefined;
        this.pump();
      }, this.debounceMs);
    }
  }

  private dispatch(cue: Cue): void {
    if (this.mode === 'voice') this.deps.speech?.speak(cue.text);
    else if (this.mode === 'beep') this.deps.beep?.beep(cue.kind);
  }

  /** Cancel pending output and clear the queue. */
  stop(): void {
    if (this.timer !== undefined) {
      this.clearTimeoutFn(this.timer);
      this.timer = undefined;
    }
    this.queue.length = 0;
    this.deps.speech?.cancel();
  }
}

// ── Production ports (thin wrappers; not exercised in jsdom, guarded for absence) ──────────────

/** Web Speech synthesis port. Returns a no-op if the API is unavailable. */
export function createSpeechPort(): SpeechPort {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth) return { speak: () => {}, cancel: () => {} };
  return {
    speak: (text) => synth.speak(new SpeechSynthesisUtterance(text)),
    cancel: () => synth.cancel(),
  };
}

/** WebAudio beep port: two short rising beeps for "prepare", one longer high beep for "turn". */
export function createBeepPort(ctx: AudioContext): BeepPort {
  const tone = (freq: number, startS: number, durS: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.connect(gain).connect(ctx.destination);
    const t0 = ctx.currentTime + startS;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durS);
    osc.start(t0);
    osc.stop(t0 + durS + 0.02);
  };
  return {
    beep: (kind) => {
      if (kind === 'prepare') {
        tone(880, 0, 0.12);
        tone(880, 0.18, 0.12);
      } else {
        tone(1320, 0, 0.35);
      }
    },
  };
}

/**
 * Build an Announcer wired to real ports, unlocking audio on a user gesture. Call from the
 * "Start ride" handler. Beep mode needs an AudioContext; falls back to silent if unavailable.
 */
export function armAudio(mode: CueMode, deps: AnnouncerDeps = {}): Announcer {
  const speech = deps.speech ?? createSpeechPort();
  let beep = deps.beep;
  if (!beep && mode === 'beep' && typeof window !== 'undefined') {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      void ctx.resume();
      beep = createBeepPort(ctx);
    }
  }
  return new Announcer(mode, { ...deps, speech, beep });
}
