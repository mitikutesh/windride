import { describe, expect, it } from 'vitest';
import { Announcer, type BeepPort, type SpeechPort } from './announcer';
import { CueScheduler, type Cue, type CueKind, type CuePoint } from './cues';

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
    a.announce(cue('B', 2)); // queued behind the debounce
    a.stop();
    expect(cancelled).toBe(1);
    h.setTime(3000);
    h.fireLast(); // the stale debounce timer must be harmless after stop()
    expect(h.spoken).toEqual(['A']);
  });
});

describe('CueScheduler → Announcer integration', () => {
  it('two turns 60 m apart dispatch in ride order, never < 3 s apart', () => {
    const cps: CuePoint[] = [
      { stepIndex: 1, turnDistanceM: 1000, instruction: 'Turn left onto A', type: 0 },
      { stepIndex: 2, turnDistanceM: 1060, instruction: 'Turn right onto B', type: 1 },
    ];
    const scheduler = new CueScheduler(cps);
    const events: { text: string; at: number }[] = [];
    let t = 0;
    const timers: { due: number; cb: () => void; done: boolean }[] = [];
    const announcer = new Announcer('voice', {
      speech: { speak: (s) => events.push({ text: s, at: t }), cancel: () => {} },
      now: () => t,
      setTimeoutFn: (cb, ms) => {
        timers.push({ due: t + ms, cb, done: false });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
      debounceMs: 3000,
    });

    // Ride the segment at nominal 5.5 m/s, 1 Hz, starting 100 m before the first turn.
    for (let tick = 0; tick < 60; tick += 1) {
      t = tick * 1000;
      for (const timer of timers) {
        if (!timer.done && timer.due <= t) {
          timer.done = true;
          timer.cb();
        }
      }
      const progressM = 900 + tick * 5.5;
      for (const c of scheduler.update(progressM, 5.5)) announcer.announce(c);
    }
    // Drain any still-pending debounce timers.
    let guard = 0;
    while (timers.some((x) => !x.done) && guard++ < 20) {
      const next = timers.filter((x) => !x.done).sort((a, b) => a.due - b.due)[0];
      t = next.due;
      next.done = true;
      next.cb();
    }

    expect(events.map((e) => e.text)).toEqual([
      'In 100 metres, left onto A',
      'In 150 metres, right onto B',
      'Turn left now',
      'Turn right now',
    ]);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i].at - events[i - 1].at).toBeGreaterThanOrEqual(3000);
    }
  });
});
