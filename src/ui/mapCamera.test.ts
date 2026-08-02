import { describe, expect, it } from 'vitest';
import {
  CAMERA_EASE_MS,
  CAMERA_LONG_EASE_MS,
  cameraTargetFor,
  cruiseZoomM,
  DEFAULT_ACROSS_M,
  PUCK_FRACTION,
  turnApproachZoomM,
  ZOOM_APPROACH_M,
  ZOOM_JUNCTION_ACROSS_M,
  ZOOM_LOOKAHEAD_S,
  ZOOM_MAX_ACROSS_M,
  ZOOM_MIN_ACROSS_M,
  ZOOM_PLATEAU_M,
  type CameraInput,
  zoomForMetres,
} from './mapCamera';

const RIDER = { lat: 60.17, lon: 24.94 };
const H = 844;
const W = 390;
/** Live-ride chrome: the turn card on top, the stats panel (--ride-panel-clear) below. */
const LIVE_INSETS = { top: 120, bottom: 208 };

function input(over: Partial<CameraInput> = {}): CameraInput {
  return {
    anchor: RIDER,
    containerW: W,
    containerH: H,
    zoomM: 600,
    headingUp: true,
    mapBearingDeg: 90,
    currentBearingDeg: 90,
    currentZoom: zoomForMetres(600, RIDER.lat, W),
    insets: LIVE_INSETS,
    snap: false,
    ...over,
  };
}

describe('zoomForMetres', () => {
  it('asks for a higher zoom the fewer metres must fit across the view', () => {
    expect(zoomForMetres(150, 60, W)).toBeGreaterThan(zoomForMetres(1500, 60, W));
  });
  it('shows about the requested metres across the viewport width', () => {
    // Round-trip the projection: metres-per-pixel at the returned zoom should refill the width.
    const metres = 600;
    const z = zoomForMetres(metres, 60, W);
    const mpp = (40075016.686 * Math.cos((60 * Math.PI) / 180)) / (512 * 2 ** z);
    expect(mpp * W).toBeCloseTo(metres, 0);
  });
  it('stays within MapLibre zoom limits at absurd inputs', () => {
    expect(zoomForMetres(1e9, 60, W)).toBeGreaterThanOrEqual(1);
    expect(zoomForMetres(1e-9, 60, W)).toBeLessThanOrEqual(20);
  });
  it('survives a zero-width container', () => {
    expect(Number.isFinite(zoomForMetres(600, 60, 0))).toBe(true);
  });
});

describe('cruiseZoomM (WR-055)', () => {
  /** Metres of road visible AHEAD of the rider — the band above the puck, converted to metres. */
  const aheadM = (acrossM: number) => {
    const usableH = H - LIVE_INSETS.top - LIVE_INSETS.bottom;
    const aheadPx = LIVE_INSETS.top + PUCK_FRACTION * usableH - LIVE_INSETS.top;
    return (acrossM * aheadPx) / W;
  };

  const lookaheadS = (speedKmh: number) => aheadM(cruiseZoomM(speedKmh)) / (speedKmh / 3.6);

  it('shows about ZOOM_LOOKAHEAD_S seconds of road ahead wherever the policy governs', () => {
    // This is the whole point of the policy, so it is pinned here rather than left in a comment.
    // Below ~23 km/h the ZOOM_MIN_ACROSS_M floor takes over instead — see the next test.
    for (const speedKmh of [25, 40, 60]) {
      expect(lookaheadS(speedKmh)).toBeGreaterThan(ZOOM_LOOKAHEAD_S * 0.85);
      expect(lookaheadS(speedKmh)).toBeLessThan(ZOOM_LOOKAHEAD_S * 1.15);
    }
  });

  it('errs toward MORE context at low speed, never less', () => {
    // The floor governs when crawling, which buys extra look-ahead time — the safe direction. It must
    // never cut below the policy, which would leave a slow rider with less warning than a fast one.
    for (const speedKmh of [5, 10, 15, 20]) {
      expect(lookaheadS(speedKmh)).toBeGreaterThan(ZOOM_LOOKAHEAD_S);
    }
  });

  it('is nothing like the old rule it replaces', () => {
    // The old `250 + speedKmh * 40` showed ~171 s of road ahead at 25 km/h.
    const old = 250 + 25 * 40;
    expect(aheadM(old) / (25 / 3.6)).toBeGreaterThan(150); // the bug, for the record
    expect(cruiseZoomM(25)).toBeLessThan(old / 4);
  });

  it('rises with speed and clamps at both ends', () => {
    expect(cruiseZoomM(30)).toBeGreaterThan(cruiseZoomM(15));
    expect(cruiseZoomM(0)).toBe(ZOOM_MIN_ACROSS_M); // stopped: still enough to place yourself
    expect(cruiseZoomM(-5)).toBe(ZOOM_MIN_ACROSS_M); // a nonsense speed must not invert the view
    expect(cruiseZoomM(500)).toBe(ZOOM_MAX_ACROSS_M);
  });
});

describe('turnApproachZoomM (WR-055)', () => {
  const CRUISE = 600;

  it('leaves cruise alone with no maneuver in reach', () => {
    expect(turnApproachZoomM(null, CRUISE)).toBe(CRUISE); // no steps at all
    expect(turnApproachZoomM(ZOOM_APPROACH_M + 1, CRUISE)).toBe(CRUISE);
  });

  it('is fully tight across the plateau, so the view is settled before the junction', () => {
    expect(turnApproachZoomM(ZOOM_PLATEAU_M, CRUISE)).toBe(ZOOM_JUNCTION_ACROSS_M);
    expect(turnApproachZoomM(0, CRUISE)).toBe(ZOOM_JUNCTION_ACROSS_M); // at/through the node
  });

  it('tightens monotonically along the approach', () => {
    let prev = Infinity;
    for (let prox = ZOOM_APPROACH_M; prox >= 0; prox -= 20) {
      const across = turnApproachZoomM(prox, CRUISE);
      expect(across).toBeLessThanOrEqual(prev);
      prev = across;
    }
    expect(prev).toBe(ZOOM_JUNCTION_ACROSS_M);
  });

  it('never zooms OUT for a turn, however slowly the rider is going', () => {
    // A stopped rider cruises at ZOOM_MIN_ACROSS_M, which is already tighter than the junction view.
    const slow = ZOOM_MIN_ACROSS_M;
    expect(slow).toBeLessThan(ZOOM_JUNCTION_ACROSS_M * 2); // guards the premise of this test
    for (const prox of [0, ZOOM_PLATEAU_M, 120, ZOOM_APPROACH_M]) {
      expect(turnApproachZoomM(prox, slow)).toBeLessThanOrEqual(slow);
    }
    expect(turnApproachZoomM(0, 100)).toBe(100); // cruise already tighter than the junction target
  });
});

describe('cameraTargetFor', () => {
  it('centres on the anchor and zooms to the requested metres across', () => {
    const t = cameraTargetFor(input({ zoomM: 300 }));
    expect(t.center).toEqual([RIDER.lon, RIDER.lat]);
    expect(t.zoom).toBeCloseTo(zoomForMetres(300, RIDER.lat, W), 6);
  });

  it('falls back to the default view width when no zoom is requested', () => {
    for (const zoomM of [null, undefined, 0, -50]) {
      expect(cameraTargetFor(input({ zoomM })).zoom).toBeCloseTo(
        zoomForMetres(DEFAULT_ACROSS_M, RIDER.lat, W),
        6,
      );
    }
  });

  it('north-up faces north and leaves the rider centred', () => {
    const t = cameraTargetFor(input({ headingUp: false, currentBearingDeg: 0 }));
    expect(t.bearing).toBe(0);
    expect(t.offset).toEqual([0, 0]);
    // No rotation was asked for, so the platform's reduced-motion preference is left alone.
    expect(t.essential).toBe(false);
  });

  it('heading-up rotates to the map bearing and pushes the rider down the screen', () => {
    const t = cameraTargetFor(input({ mapBearingDeg: 210 }));
    expect(t.bearing).toBeCloseTo(210, 6);
    // +y draws the rider lower than centre, so the road ahead gets the bigger share of the map.
    expect(t.offset[0]).toBe(0);
    expect(t.offset[1]).toBeGreaterThan(0);
    expect(t.essential).toBe(true);
  });

  it('places the rider at PUCK_FRACTION of the band the chrome leaves visible', () => {
    const t = cameraTargetFor(input());
    const usableH = H - LIVE_INSETS.top - LIVE_INSETS.bottom;
    const expectedY = LIVE_INSETS.top + PUCK_FRACTION * usableH - H / 2;
    expect(t.offset[1]).toBe(Math.round(expectedY));
    // Sanity: the rider must land inside the visible band, not under the stats panel.
    const screenY = H / 2 + t.offset[1];
    expect(screenY).toBeGreaterThan(LIVE_INSETS.top);
    expect(screenY).toBeLessThan(H - LIVE_INSETS.bottom);
  });

  it('measures the puck fraction against the whole container when there is no chrome', () => {
    const t = cameraTargetFor(input({ insets: { top: 0, bottom: 0 } }));
    expect(t.offset[1]).toBe(Math.round(PUCK_FRACTION * H - H / 2));
  });

  it('normalises a bearing outside 0..360', () => {
    expect(cameraTargetFor(input({ mapBearingDeg: -90 })).bearing).toBeCloseTo(270, 6);
  });

  it('stays north-up until a map bearing exists, even in heading-up mode', () => {
    const t = cameraTargetFor(input({ mapBearingDeg: null }));
    expect(t.bearing).toBe(0);
    expect(t.offset).toEqual([0, 0]); // "up" is unknown, so there is no "ahead" to bias toward
    expect(t.essential).toBe(false);
  });

  it('eases longer for a big rotation than for a small one', () => {
    expect(cameraTargetFor(input({ currentBearingDeg: 88 })).duration).toBe(CAMERA_EASE_MS);
    // Recentring after free-look: the map is facing the other way and must not whip round.
    expect(cameraTargetFor(input({ mapBearingDeg: 280, currentBearingDeg: 90 })).duration).toBe(
      CAMERA_LONG_EASE_MS,
    );
  });

  it('measures the rotation across 0°/360° and against MapLibre’s −180..180 bearing', () => {
    // getBearing() reports −170 where the gate reports 190: a 0° turn, not a 360° one.
    expect(cameraTargetFor(input({ mapBearingDeg: 190, currentBearingDeg: -170 })).duration).toBe(
      CAMERA_EASE_MS,
    );
  });

  it('eases longer for a big ZOOM change even with no rotation at all', () => {
    // An Auto tap or an accepted reroute can move several zoom levels while facing the same way.
    const wide = cameraTargetFor(
      input({ zoomM: 2000, currentZoom: zoomForMetres(140, RIDER.lat, W) }),
    );
    expect(wide.duration).toBe(CAMERA_LONG_EASE_MS);
    // A junction approach step is small, and must keep the short ease.
    const step = cameraTargetFor(
      input({ zoomM: 200, currentZoom: zoomForMetres(220, RIDER.lat, W) }),
    );
    expect(step.duration).toBe(CAMERA_EASE_MS);
  });

  it('jumps instead of easing under battery saver', () => {
    expect(cameraTargetFor(input({ snap: true })).duration).toBe(0);
    expect(cameraTargetFor(input({ snap: true, currentBearingDeg: 280 })).duration).toBe(0);
    expect(cameraTargetFor(input({ snap: true, zoomM: 2000 })).duration).toBe(0);
  });
});
