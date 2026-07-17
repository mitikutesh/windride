/**
 * engine/winter.ts — Winter / Nordic mode heuristics (WR-027, PRODUCT_SPEC §3, SCORING_SPEC §5).
 * Pure. Season suggestion, precipitation-type awareness (snow ≠ rain), an ICE-RISK caution (never a
 * guarantee), studded-tyre speed offsets, and the shaded/forest stretches that stay icy longest.
 *
 * The ice-risk flag is intentionally conservative and advisory — "possible ice, ride like it's
 * there". We never claim a road IS or ISN'T icy; friction modelling and maintenance feeds are out
 * of scope. Daylight is enforced as a hard constraint (winter defaults home-before-dark ON), which
 * lives in scoring.ts §5 — this module only supplies the winter defaults + copy.
 */
import type { Surface } from '../domain';
import type { CandidateAnalysis } from './scoring';
import type { SpeedSettings } from './speedModel';

/** At/below this temperature (°C) the app suggests Winter mode (still a manual toggle). */
export const WINTER_SUGGEST_TEMP_C = 3;
/** Ice-risk fires only when the coldest hour in the ride window is at/below this (°C). */
export const ICE_RISK_TEMP_C = 1;
/** Studded winter tyres cost roughly this much base speed (km/h) on every surface (linear model). */
export const STUDDED_OFFSET_KMH = 3;
/** Studded tyres raise rolling resistance ~30% — how the PHYSICS model feels the same slowdown. */
export const WINTER_CRR_MULT = 1.3;
/** Exposure at/below this (deep shade / forest) stays icy longest after a thaw-freeze. */
export const ICY_SHADE_EXPOSURE_MAX = 0.5;

/** Temperature-based season suggestion (the owner can always override with the manual toggle). */
export function suggestWinter(tempC: number): boolean {
  return tempC <= WINTER_SUGGEST_TEMP_C;
}

export type PrecipType = 'none' | 'snow' | 'sleet' | 'rain';

/** Precipitation type inferred from temperature — so winter copy says "snow", not "rain". */
export function precipType(tempC: number, precipProb: number): PrecipType {
  if (precipProb < 20) return 'none';
  if (tempC <= 0) return 'snow';
  if (tempC <= 2) return 'sleet';
  return 'rain';
}

export interface IceRiskInput {
  /** Coldest temperature (°C) across the ride's forecast window. */
  minTempC: number;
  /** Total precipitation (mm) in the 24 h BEFORE the ride — wet + freezing ⇒ ice. */
  precipPrior24hMm: number;
}

/**
 * Ice-risk heuristic (advisory): the coldest hour is at/below +1 °C AND it precipitated in the prior
 * 24 h, so surfaces may have frozen. Conservative by design — a caution, never a guarantee.
 */
export function iceRisk(input: IceRiskInput): boolean {
  return input.minTempC <= ICE_RISK_TEMP_C && input.precipPrior24hMm > 0;
}

/** The ice-risk caution copy — always hedged; shaded stretches called out when present. */
export function iceRiskMessage(shadedKm: number): string {
  const base = 'Possible ice — ride like it’s there.';
  return shadedKm > 0
    ? `${base} Shaded/forest stretches (${shadedKm.toFixed(1)} km) stay icy longest.`
    : base;
}

/**
 * Studded-tyre winter speed model. The LINEAR model slows via a base-speed offset per surface; the
 * PHYSICS model slows via raised rolling resistance (crr) — so studded ETAs are honestly slower
 * whichever model is active (a base-speed offset alone would be a no-op under physics, where baseKmh
 * is only the Newton seed).
 */
export function winterSpeedSettings(
  base: SpeedSettings,
  offset = STUDDED_OFFSET_KMH,
  crrMult = WINTER_CRR_MULT,
): SpeedSettings {
  const baseKmh = {} as Record<Surface, number>;
  for (const surface of Object.keys(base.baseKmh) as Surface[]) {
    baseKmh[surface] = Math.max(base.minKmh, base.baseKmh[surface] - offset);
  }
  const crr = {} as Record<Surface, number>;
  for (const surface of Object.keys(base.crr) as Surface[]) {
    crr[surface] = base.crr[surface] * crrMult;
  }
  return { ...base, baseKmh, crr };
}

/** Kilometres of the route in deep shade / forest (exposure ≤ 0.5) — the last to thaw. */
export function shadedKm(analysis: CandidateAnalysis): number {
  let m = 0;
  for (const sa of analysis.segments)
    if (sa.seg.exposure <= ICY_SHADE_EXPOSURE_MAX) m += sa.seg.lengthM;
  return m / 1000;
}
