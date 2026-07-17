import { describe, expect, it } from 'vitest';
import { Announcer, type BeepPort, type SpeechPort } from './announcer';
import type { Cue, CueKind } from './cues';

const cue = (text: string, stepIndex: number, kind: CueKind = 'prepare'): Cue => ({
  stepIndex,
  kind,
  text,
  turnDistanceM: 0,
});

/** A controllable clock + timer list so debounce timing is asserted without real time. */
function harness() {
  let t = 0;
  const scheduled: { ms: number; cb: () => void }[] = [];
  const spoken: string[] = [];
  const beeps: CueKind[] = [];
  const speech: SpeechPort = { speak: (s) => spoken.push(s), cancel: () => {} };
  const beep: BeepPort = { beep: (k) => beeps.push(k) };
  const deps = {
    speech,
    beep,
    now: () => t,
    setTimeoutFn: (cb: () => void, ms: number) => {
      scheduled.push({ ms, cb });
      return scheduled.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: () => {},
    debounceMs: 3000,
  };
  return {
    spoken,
    beeps,
    scheduled,
    setTime: (v: number) => (t = v),
    fireLast: () => scheduled[scheduled.length - 1].cb(),
    deps,
  };
}

describe('Announcer', () => {
  it('voice mode speaks the first cue immediately', () => {
    const h = harness();
    const a = new Announcer('voice', h.deps);
    a.announce(cue('In 200 metres, left onto Rantaraitti', 1));
    expect(h.spoken).toEqual(['In 200 metres, left onto Rantaraitti']);
  });

  it('debounces: two cues < 3 s apart never overlap (second waits)', () => {
    const h = harness();
    const a = new Announcer('voice', h.deps);
    a.announce(cue('first', 1, 'turn')); // t=0 -> dispatched now
    h.setTime(500);
    a.announce(cue('second', 2, 'turn')); // 0.5 s later -> queued, not spoken
    expect(h.spoken).toEqual(['first']);
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0].ms).toBe(2500); // waits out the remaining debounce
    h.setTime(3000);
    h.fireLast();
    expect(h.spoken).toEqual(['first', 'second']);
  });

  it('collapses a superseded cue for the same step while queued', () => {
    const h = harness();
    const a = new Announcer('voice', h.deps);
    a.announce(cue('A', 1)); // dispatched
    a.announce(cue('B-prepare', 2, 'prepare')); // queued
    a.announce(cue('B-turn', 2, 'turn')); // supersedes B-prepare in the queue
    h.setTime(3000);
    h.fireLast();
    expect(h.spoken).toEqual(['A', 'B-turn']);
  });

  it('beep mode plays distinct patterns per kind', () => {
    const h = harness();
    const a = new Announcer('beep', h.deps);
    a.announce(cue('x', 1, 'prepare')); // dispatched now
    h.setTime(3000);
    a.announce(cue('y', 2, 'turn'));
    expect(h.beeps).toEqual(['prepare', 'turn']);
    expect(h.spoken).toEqual([]);
  });

  it('silent mode announces nothing', () => {
    const h = harness();
    const a = new Announcer('silent', h.deps);
    a.announce(cue('x', 1, 'turn'));
    expect(h.spoken).toEqual([]);
    expect(h.beeps).toEqual([]);
  });

  it('stop() cancels speech and clears the queue', () => {
    const h = harness();
    let cancelled = 0;
    const a = new Announcer('voice', {
      ...h.deps,
      speech: { speak: (s) => h.spoken.push(s), cancel: () => (cancelled += 1) },
    });
    a.announce(cue('A', 1)); // dispatched
    h.setTime(500);
    a.announce(cue('B', 2)); // queued
    a.stop();
    expect(cancelled).toBe(1);
    h.setTime(3000);
    // Nothing further should dispatch after stop cleared the queue.
    expect(h.spoken).toEqual(['A']);
  });
});
