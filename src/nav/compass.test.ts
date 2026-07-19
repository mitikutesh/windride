import { describe, expect, it } from 'vitest';
import { CompassHeadingSource, compassHeadingOf, type OrientationTarget } from './compass';

/** A fake event target that captures listeners and lets a test dispatch orientation readings. */
function fakeTarget(opts: { absoluteEvent?: boolean } = {}) {
  const listeners = new Map<string, (e: Event) => void>();
  const target: OrientationTarget & { ondeviceorientationabsolute?: null } = {
    addEventListener: (type, l) => listeners.set(type, l),
    removeEventListener: (type, l) => {
      if (listeners.get(type) === l) listeners.delete(type);
    },
  };
  if (opts.absoluteEvent) target.ondeviceorientationabsolute = null; // makes the `in` check true
  return {
    target,
    listeners,
    emit: (type: string, reading: Record<string, unknown>) =>
      listeners.get(type)?.(reading as unknown as Event),
  };
}

describe('compassHeadingOf', () => {
  it('uses webkitCompassHeading directly (iOS: already true-north, clockwise)', () => {
    expect(compassHeadingOf({ webkitCompassHeading: 90, alpha: null })).toBe(90);
    expect(compassHeadingOf({ webkitCompassHeading: 370, alpha: null })).toBe(10); // normalized
  });
  it('converts absolute alpha (CCW from north) to a clockwise heading', () => {
    expect(compassHeadingOf({ absolute: true, alpha: 90 })).toBe(270); // 360 - 90
    expect(compassHeadingOf({ absolute: true, alpha: 0 })).toBe(0); // 360 → 0
  });
  it('ignores relative orientation (no absolute heading available)', () => {
    expect(compassHeadingOf({ absolute: false, alpha: 42 })).toBeNull();
    expect(compassHeadingOf({ alpha: 42 })).toBeNull(); // absolute undefined
  });
  it('prefers webkit heading, but falls through to alpha when it is NaN', () => {
    expect(compassHeadingOf({ webkitCompassHeading: NaN, absolute: true, alpha: 90 })).toBe(270);
  });
  it('honours alpha on the absolute event even when the absolute field is omitted', () => {
    expect(compassHeadingOf({ alpha: 90 }, true)).toBe(270); // event is absolute by definition
    expect(compassHeadingOf({ alpha: 90 }, false)).toBeNull(); // plain event, no absolute → dropped
  });
});

describe('CompassHeadingSource', () => {
  it('listens on the absolute event where available and converts alpha', () => {
    const f = fakeTarget({ absoluteEvent: true });
    const src = new CompassHeadingSource(f.target, 1); // alpha 1 ⇒ EMA pass-through
    const got: number[] = [];
    src.start((d) => got.push(d));
    expect(f.listeners.has('deviceorientationabsolute')).toBe(true);
    f.emit('deviceorientationabsolute', { absolute: true, alpha: 90 });
    expect(got).toEqual([270]);
  });

  it('emits from the absolute event even if the browser omits the absolute field', () => {
    const f = fakeTarget({ absoluteEvent: true });
    const src = new CompassHeadingSource(f.target, 1);
    const got: number[] = [];
    src.start((d) => got.push(d));
    f.emit('deviceorientationabsolute', { alpha: 90 }); // no `absolute` field set
    expect(got).toEqual([270]);
  });

  it('falls back to the plain event for iOS webkitCompassHeading', () => {
    const f = fakeTarget(); // no absolute-event support
    const src = new CompassHeadingSource(f.target, 1);
    const got: number[] = [];
    src.start((d) => got.push(d));
    expect(f.listeners.has('deviceorientation')).toBe(true);
    f.emit('deviceorientation', { webkitCompassHeading: 123, alpha: null });
    expect(got).toEqual([123]);
  });

  it('drops relative-only readings', () => {
    const f = fakeTarget();
    const src = new CompassHeadingSource(f.target, 1);
    const got: number[] = [];
    src.start((d) => got.push(d));
    f.emit('deviceorientation', { absolute: false, alpha: 42 });
    expect(got).toEqual([]);
  });

  it('smooths jitter with a circular EMA (second reading lags toward the new angle)', () => {
    const f = fakeTarget();
    const src = new CompassHeadingSource(f.target); // default EMA alpha
    const got: number[] = [];
    src.start((d) => got.push(d));
    f.emit('deviceorientation', { webkitCompassHeading: 0 });
    f.emit('deviceorientation', { webkitCompassHeading: 100 });
    expect(got[0]).toBeCloseTo(0, 6); // first reading seeds the filter
    expect(got[1]).toBeGreaterThan(0);
    expect(got[1]).toBeLessThan(100); // lags, not a jump
  });

  it('stop() removes the listener', () => {
    const f = fakeTarget();
    const src = new CompassHeadingSource(f.target, 1);
    src.start(() => {});
    expect(f.listeners.size).toBe(1);
    src.stop();
    expect(f.listeners.size).toBe(0);
  });

  it('start() replaces a prior stream (no listener leak)', () => {
    const f = fakeTarget();
    const src = new CompassHeadingSource(f.target, 1);
    src.start(() => {});
    src.start(() => {});
    expect(f.listeners.size).toBe(1); // old listener removed before the new one is added
  });
});

describe('CompassHeadingSource.requestPermission', () => {
  it('maps a granted prompt to granted', async () => {
    expect(await CompassHeadingSource.requestPermission(async () => 'granted')).toBe('granted');
  });
  it('maps a denied (or any non-granted) prompt to denied', async () => {
    expect(await CompassHeadingSource.requestPermission(async () => 'denied')).toBe('denied');
    expect(await CompassHeadingSource.requestPermission(async () => 'prompt')).toBe('denied');
  });
  it('treats a thrown/blocked prompt as denied, not a crash', async () => {
    expect(
      await CompassHeadingSource.requestPermission(async () => {
        throw new Error('blocked');
      }),
    ).toBe('denied');
  });
  it('reports unsupported when there is no gate and no DeviceOrientation (node/desktop)', async () => {
    expect(await CompassHeadingSource.requestPermission(null)).toBe('unsupported');
  });
});
