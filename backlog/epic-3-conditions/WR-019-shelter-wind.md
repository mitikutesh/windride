# WR-019 · Shelter-aware effective wind + shelter sub-score
Epic: 3 · Conditions | Status: TODO | Depends on: WR-018 | Size: M

## Goal
Turn the grid into felt wind: every segment gets its exposure factor, W_eff drives all wind
math, the Shelter sub-score goes live, explanations start saying "hidden in Nuuksio forest".

## Context (read first)
SCORING_SPEC §2, §4 (Shelter), §6 · WR-018 output format.

## Acceptance criteria
- [ ] Segmentation fills Segment.exposure from exposureGrid (midpoint lookup); default 1.0
      outside region (flagged in results as "no shelter data here").
- [ ] W_eff and gust_eff use exposure everywhere (grep: no remaining raw-W usage in scoring).
- [ ] Shelter sub-score per spec joins the weight vector (renormalization removed for it).
- [ ] Golden fixture extended: same 3 candidates re-scored with a synthetic grid — forest-heavy
      candidate's rank improves as hand-computed; snapshot updated with Log note.
- [ ] Map (WR-009) gains shelter tint on segments with exposure ≤ 0.6; ribbon gains shelter kind.
- [ ] explain.ts emits shelter facts ("9.2 km of upwind inside forest, effective wind 3.4 m/s").

## Test contract
W_eff propagation tests (exposure 0.35 ⇒ v_par scales); UI colour mapping test extended.

## Technical notes
The acceptance harness (WR-011) thresholds may shift — rerun, adjust with reasoning in Log.

## Out of scope
Gust flags UI (WR-021).

## Log
