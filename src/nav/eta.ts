/**
 * nav/eta.ts — wind-aware ETA correction (WR-016, NAVIGATION_SPEC §5). Pure.
 *
 * The speed model gives a modelled time for the remaining route. Real riding drifts from the model
 * (fitness, headwind we under/over-modelled), so we track an EMA of actualSpeed/modelledSpeed and
 * re-scale the remaining modelled time by it: ride faster than modelled ⇒ ratio > 1 ⇒ ETA shrinks.
 */
export const ETA_EMA_ALPHA = 0.1;

export class EtaEstimator {
  /** EMA of actual/modelled speed. Starts at 1 (trust the model until we have data). */
  private ratio = 1;
  private readonly alpha: number;

  constructor(alpha: number = ETA_EMA_ALPHA) {
    this.alpha = alpha;
  }

  get speedRatio(): number {
    return this.ratio;
  }

  /** Fold one fix's actual vs modelled speed (m/s) into the EMA. Ignores non-positive modelled. */
  update(actualMs: number, modelledMs: number): void {
    if (modelledMs <= 0 || !Number.isFinite(actualMs) || actualMs < 0) return;
    const sample = actualMs / modelledMs;
    this.ratio = this.alpha * sample + (1 - this.alpha) * this.ratio;
  }

  /** Correct a remaining modelled time (s) by the current speed ratio. */
  correct(remainingModelledS: number): number {
    return this.ratio > 0 ? remainingModelledS / this.ratio : remainingModelledS;
  }
}
