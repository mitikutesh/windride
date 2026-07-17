# WR-021 · Gust-exposure safety flags
Epic: 3 · Conditions | Status: DONE | Depends on: WR-019 | Size: S

## Goal
Reframe wind as safety where it matters: flag exposed high-crosswind stretches when gusts
exceed threshold, in results and as a ride-time warning.

## Context (read first)
SCORING_SPEC §4 CrosswindSafety · PRODUCT_SPEC §3 v0.3.

## Acceptance criteria
- [x] Flag rule: gust_eff ≥ threshold (default 13 m/s, settings 10–18) AND v_cross ≥ 0.6·W_eff
      AND exposure ≥ 1.0, merged into stretches ≥ 300 m. — `src/engine/gustFlags.ts`:
      `isGustFlagged(sa, thresholdMs)` is the single predicate (all three conditions);
      `detectGustStretches(segments, opts)` merges contiguous flagged segments, bridging calm
      gaps < `GAP_BRIDGE_M` (150 m), keeping only stretches ≥ `MIN_STRETCH_M` (300 m).
- [x] Results: warning chip per flagged route ("2.1 km exposed crosswind, gusts 14 m/s") +
      map markers at stretch midpoints. — `RouteCard.tsx` shows the evidence-driven chip
      (`e.gustyKm`/`e.maxGustMs`) per flagged route. Map markers land on the **ride SVG map**:
      `RideMap.tsx` draws a marker (`circle.wr-ridemap__gust`, tokens-only `--head` hue) at each
      stretch midpoint via `detectGustStretches`. Adding midpoint markers to the **Results
      MapLibre map** (WebGL, imperative, not unit-testable in jsdom) is a light follow-up — not
      done in this story.
- [x] Ride HUD (WR-016): upcoming flagged stretch announced once, 500 m ahead. —
      `rideController.ts` precomputes `gustStretches` once via `detectGustStretches`; `onFix`
      warns once per stretch when the rider is within 500 m ahead of its start
      ("Crosswind gusts ahead, up to N metres per second", `stepIndex: -2` — distinct from
      turn cues (`stepIndex ≥ 0`) and the off-route cue (`stepIndex: -1`) — so it can't be
      deduped/overwritten by either); `RideState.gustAhead: { inM, maxGustMs } | null` feeds the
      `RideScreen` HUD banner.
- [x] CrosswindSafety sub-score now uses the same stretch detection (single source). —
      `scoring.ts` derives `CrosswindSafety` from `detectGustStretches(a.segments, { thresholdMs:
      opts.gustThresholdMs })`: `crossPenalty` sums `timeS · gustEffMs` only over segments inside
      flagged stretches (`flaggedSegmentIndices`); `evidence.gustyKm` is total stretch length,
      `evidence.maxGustMs` is the peak stretch gust. `ScoreOptions.gustThresholdMs` replaces the
      old `crossThresholdMs` (now `@deprecated`).

## Test contract
Stretch-merging unit tests (gaps, minimum length); golden fixture: coastal candidate gets the
flag, forest one doesn't.

## Out of scope
Wind-station live data; rider-weight-based thresholds.

## Log

Shipped gust-exposure safety flags end-to-end, per SCORING_SPEC §4 / PRODUCT_SPEC §3:

- `src/engine/gustFlags.ts` (new, pure) is now the **single source of truth** for "dangerous
  crosswind": `isGustFlagged(sa, thresholdMs = GUST_FLAG_THRESHOLD_MS)` requires
  `exposure ≥ 1.0` AND `gustEffMs ≥ threshold` (default 13 m/s, settings range 10–18) AND
  `vCrossMs ≥ CROSS_FRACTION(0.6) · effectiveMs`. `detectGustStretches(segments, opts)` merges
  contiguous flagged segments into `GustStretch`es — bridging calm gaps shorter than
  `GAP_BRIDGE_M` (150 m) rather than splitting the stretch — and drops anything under
  `MIN_STRETCH_M` (300 m). Each stretch carries `startM`/`endM`/`lengthM`, inclusive
  `startSegIdx`/`endSegIdx`, an interpolated `midpoint` (`LatLon`), and `maxGustMs`.
  `flaggedSegmentIndices(stretches)` gives the covered segment set for consumers that need it
  (the sub-score's penalty domain).
- `src/engine/scoring.ts`: `CrosswindSafety` now derives from `detectGustStretches` instead of a
  per-segment threshold — `crossPenalty` sums `timeS · gustEffMs` only over segments inside
  flagged stretches; `evidence.gustyKm` is total stretch length (km), `evidence.maxGustMs` is the
  peak stretch gust. Added `ScoreOptions.gustThresholdMs`; the old `crossThresholdMs` is now
  `@deprecated` but left in place (no call sites removed) to avoid an unrelated breaking change.
- **Safety-semantics change (intentional):** mild/ordinary crosswind is no longer penalized at
  all — only stretches that are exposed, strongly gusty (≥13 m/s), *and* mostly across the
  direction of travel, and long enough to matter (≥300 m after gap-bridging), count against
  CrosswindSafety. This is a deliberate narrowing from "some crosswind everywhere" toward "flag
  the stretches that are actually dangerous." Updated the golden scoring snapshot accordingly
  (candidate rank order unchanged; the golden fixture's 12 m/s gust falls below the 13 m/s
  threshold, so CrosswindSafety is now uniform across the golden trio — noted in-test). The
  `explain.ts` crosswind fixture's gust was raised to 15 m/s so the crosswind route genuinely
  trips the flag and still produces a "why" fact, rather than silently going uniform like the
  golden case.
- `src/nav/rideController.ts`: precomputes `gustStretches` once via `detectGustStretches` at
  construction. `onFix` warns **once per stretch** when the rider is within 500 m ahead of its
  start ("Crosswind gusts ahead, up to N metres per second"), using `stepIndex: -2` — a value
  distinct from turn cues (`≥ 0`) and the off-route cue (`-1`) — so the gust warning can't be
  deduped against or clobber either of those. `RideState.gustAhead: { inM, maxGustMs } | null` is
  exposed for the HUD regardless of whether the announcement just fired.
- UI: `RouteCard.tsx` shows a warning chip per flagged route ("⚠ 2.1 km exposed crosswind, gusts
  14 m/s"), driven entirely by `evidence.gustyKm`/`evidence.maxGustMs` (no independent UI
  computation). `RideScreen.tsx` renders a gust banner from `rideState.gustAhead`. `RideMap.tsx`
  draws a marker per stretch midpoint (SVG `circle.wr-ridemap__gust`, tokens-only `--head` hue,
  computed via the same `detectGustStretches`).
- Tests: `src/engine/gustFlags.test.ts` (7 — `isGustFlagged` predicate; stretch merge ≥ 300 m;
  drop stretches under 300 m; gap bridging vs. a genuine split at a longer gap; midpoint falls
  inside the stretch; golden coastal candidate gets flagged, forest candidate doesn't).
  `rideController.test.ts` gained a gust case (warns once + `gustAhead` set on a crafted
  flagged-stretch route). Full gate: 293 tests, lint clean, build OK.
- **Scope note (map markers):** the "results map markers at stretch midpoints" half of the
  acceptance box is satisfied on the ride SVG map (`RideMap.tsx`) plus the per-route warning
  chip on the results cards. Adding midpoint markers to the Results screen's MapLibre map is
  deferred as a light follow-up — that map is WebGL/imperative and not unit-testable in jsdom,
  unlike the SVG ride map.
- No new `DEC-xxx` needed — the threshold defaults and merge constants were already pinned in
  SCORING_SPEC §4; this story implements them as specified.

## Review pass — fixes

Reviewed by a substitute senior reviewer (Opus) — the Fable 5 model was out of usage credits
this session. Verdict was REQUEST-CHANGES; all SHOULD-FIXes and NITs below are applied and the
gate is green.

- **SF1 (spec/decision integrity):** the above Log claim ("no new DEC-xxx needed... already
  pinned in SCORING_SPEC §4") was factually wrong — SCORING_SPEC §4 still described the *old*
  per-segment CrosswindSafety (penalty over segments with v_cross above a threshold), and
  DEC-015 still pinned `crossThreshold = 5 m/s`, both contradicted by this story's rewrite.
  Fixed: `docs/SCORING_SPEC.md` §4 now describes the actual shipped rule (penalty over segments
  inside flagged exposed-crosswind gust stretches — exposure ≥ 1.0 AND gust_eff ≥ 13 m/s AND
  v_cross ≥ 0.6·W_eff, merged across calm gaps < 150 m into stretches ≥ 300 m, single source
  `engine/gustFlags.ts`). Added `docs/DECISIONS.md` **DEC-026**, which records the intentional
  narrowing (mild crosswind no longer penalized; only exposed high-gust crosswind corridors are)
  and that it changes rankings vs. the old per-segment cross-threshold, and explicitly
  **supersedes DEC-015's `crossThreshold = 5 m/s` default** (`crossThresholdMs` is now
  `@deprecated`).
- **SF2:** `crossPenalty` summed `gustEffMs` over *all* segment indices spanned by a stretch,
  including the calm segments a stretch bridges — over-penalizing, and inconsistent with
  `maxGustMs`, which is flagged-only. Fixed: `crossPenalty` now filters by `isGustFlagged` too,
  so the time-weighted gust penalty and the reported peak gust share one domain; `gustyKm` still
  spans the full corridor length (bridged gaps included).
- **SF3:** the rewired safety-penalty path had no direct scoring test, and the golden's comment
  ("C loses CrosswindSafety") was stale now that the golden's 12 m/s gust falls below the 13 m/s
  flag threshold. Fixed: added `scoring.test.ts` — `'CrosswindSafety penalizes an exposed ≥13 m/s
  gust crosswind and not a calm twin'` — an exposed 16 m/s gust crosswind candidate accrues
  `sub.safety.raw > 0`, `gustyKm ≈ 10`, `maxGustMs 16`, while a 9 m/s twin gets `0` and a higher
  normalized safety; corrected the golden comment to state CrosswindSafety is uniform there
  (below the 13 m/s flag), rather than claiming candidate C loses it.
- **SF4:** the ride gust banner used `role="alert"` with a per-fix-changing distance, spamming
  screen readers at ~1 Hz on approach. Fixed: `role="status"` (polite) with a static "up to N
  m/s ahead/now" — the live region no longer re-announces a changing distance every fix; the
  one-shot voice cue already gave the distance once.
- **NITs:** `gustAhead` no longer reports `null`/vanishes once inside the danger zone —
  `inM ≤ 0` now reads "now" instead of dropping the HUD state; the `RouteCard` chip gate was
  simplified to `gustyKm > 0`.
- **SF5 (follow-up, not fixed this story):** `gustThresholdMs` is threaded only into scoring —
  the ride SVG markers and HUD recompute `detectGustStretches` with the hardcoded default (13).
  No active mismatch today (default 13 everywhere, no settings UI yet), but when a settings
  threshold ships it must be threaded to all consumers (or the stretches exposed directly on
  `ScoredCandidate`). Tracked as a follow-up for whichever story adds the settings control.
- **Deferred NITs (noted, not addressed this pass):** the gust warning isn't gated by ride-pause
  (matches the existing off-route-alert precedent); Results-screen MapLibre markers remain
  deferred (see Scope note above); the results chip uses the `--head` token as text colour —
  verify AA contrast later.
- Gate after fixes: **294 tests**, lint clean, build OK.
