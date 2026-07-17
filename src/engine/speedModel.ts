/**
 * engine/speedModel.ts — speed & time models (WR-007, SCORING_SPEC §3). Pure.
 *
 * Every user-facing duration comes from here (never naive distance/speed). The linear MVP is the
 * default; the physics model is behind the same signature via settings.model. Coefficients and
 * baseline speeds are settings-injected (DEC-004): road 27 km/h, gravel 21 km/h, 180 W.
 */
import type { Surface } from '../domain';

export interface SpeedSettings {
  model: 'linear' | 'physics';
  /** Still-air, flat base speed per surface (km/h). */
  baseKmh: Record<Surface, number>;
  // Linear coefficients (SCORING_SPEC §3):
  tailCoef: number; // + per km/h of tailwind
  headCoef: number; // + per km/h of headwind (negative v_par -> slows)
  upGradeCoef: number; // − per % of climb
  downGradeCoef: number; // + per % of descent (capped by maxKmh)
  minKmh: number;
  maxKmh: number;
  // Physics parameters:
  powerW: number;
  massKg: number;
  cda: number;
  rho: number;
  crr: Record<Surface, number>;
}

export const DEFAULT_SPEED_SETTINGS: SpeedSettings = {
  model: 'linear',
  baseKmh: { paved: 27, gravel: 21, path: 18, unknown: 24 },
  tailCoef: 0.35,
  headCoef: 0.6,
  upGradeCoef: 2.2,
  downGradeCoef: 1.2,
  minKmh: 5,
  maxKmh: 55,
  powerW: 180,
  massKg: 85,
  cda: 0.32,
  rho: 1.25,
  crr: { paved: 0.005, gravel: 0.012, path: 0.014, unknown: 0.008 },
};

const G = 9.81;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function linearSpeedKmh(base: number, gradePct: number, vParKmh: number, s: SpeedSettings): number {
  const v =
    base +
    s.tailCoef * Math.max(vParKmh, 0) +
    s.headCoef * Math.min(vParKmh, 0) -
    s.upGradeCoef * Math.max(gradePct, 0) +
    s.downGradeCoef * Math.min(gradePct, 0);
  return clamp(v, s.minKmh, s.maxKmh);
}

/** Newton-solve P = 0.5·rho·CdA·(v+wHead)²·v + Crr·m·g·v + m·g·s·v for ground speed v (m/s). */
function physicsSpeedKmh(
  surface: Surface,
  gradePct: number,
  vParMs: number,
  s: SpeedSettings,
): number {
  const wHead = -vParMs; // headwind is positive (slows); tailwind negative (helps)
  const slope = gradePct / 100;
  const crr = s.crr[surface] ?? s.crr.unknown;
  const rollGrav = crr * s.massKg * G + s.massKg * G * slope;
  let v = Math.max(1, s.baseKmh[surface] / 3.6); // initial guess (m/s)
  for (let i = 0; i < 60; i++) {
    const air = v + wHead;
    // Signed drag: air*|air| stays resistive against a headwind but PROPELS when a tailwind is
    // faster than the rider — keeping the model monotone in wind (air*air would spuriously slow).
    const absAir = Math.abs(air);
    const f = 0.5 * s.rho * s.cda * air * absAir * v + rollGrav * v - s.powerW;
    const df = 0.5 * s.rho * s.cda * (2 * absAir * v + air * absAir) + rollGrav;
    if (Math.abs(df) < 1e-9) break;
    const next = v - f / df;
    if (!Number.isFinite(next)) break;
    const clamped = clamp(next, 0.1, s.maxKmh / 3.6);
    if (Math.abs(clamped - v) < 1e-6) {
      v = clamped;
      break;
    }
    v = clamped;
  }
  return clamp(v * 3.6, s.minKmh, s.maxKmh);
}

export function segmentSpeedKmh(
  surface: Surface | undefined,
  gradePct: number,
  vParMs: number,
  s: SpeedSettings = DEFAULT_SPEED_SETTINGS,
): number {
  const surf: Surface = surface ?? 'unknown';
  if (s.model === 'physics') return physicsSpeedKmh(surf, gradePct, vParMs, s);
  return linearSpeedKmh(s.baseKmh[surf], gradePct, vParMs * 3.6, s);
}

export function segmentTimeS(lengthM: number, speedKmh: number): number {
  const speedMs = speedKmh / 3.6;
  return speedMs > 0 ? lengthM / speedMs : Infinity;
}
