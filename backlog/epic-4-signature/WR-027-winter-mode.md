# WR-027 · Winter / Nordic mode
Epic: 4 · Signature | Status: DONE | Depends on: WR-020 | Size: M

## Goal
Make the app trustworthy in the season that defines Finland: ice-risk warnings, studded-tyre
speeds, and daylight as a hard constraint by default.

## Context (read first)
PRODUCT_SPEC §3 v0.4 · SCORING_SPEC §5 · WR-018 grid (shade proxy).

## Acceptance criteria
- [x] Season detection (temp-based suggestion + manual toggle). Winter defaults: "home before
      dark" ON, studded-tyre speed offsets applied (settings), rain score replaced by
      precipitation-type awareness (snow ≠ rain in copy).
- [x] Ice-risk heuristic: flag when min temp within ride window ≤ +1 °C AND precipitation in
      prior 24 h (needs past-hours params — extend WR-004, note API param); copy warns that
      shaded/forest roads stay icy longest (exposure ≤0.5 stretches listed).
- [x] Heuristic is presented as a caution, never a guarantee ("possible ice — ride like it's
      there"); appears on results + ride start.
- [x] Golden winter fixture: late start eliminated by daylight, icy-morning flag fires.

## Test contract
Heuristic truth-table tests; daylight hard-constraint tests at Helsinki December sunset.

## Out of scope
Road-maintenance feeds; friction modelling.

## Log

**2026-07-18** — Shipped Winter/Nordic mode end to end (PRODUCT_SPEC §3 v0.4, SCORING_SPEC §5):
- `src/engine/winter.ts` (new, pure): `suggestWinter(tempC)` — suggests winter mode at ≤ +3 °C
  (`WINTER_SUGGEST_TEMP_C`); the manual toggle always wins over the suggestion. `precipType(tempC,
  precipProb)` → `'none'|'snow'|'sleet'|'rain'`, temperature-inferred (`WindSample` carries no
  snowfall field) — snow ≠ rain in copy. `iceRisk({ minTempC, precipPrior24hMm })` = coldest
  window hour ≤ +1 °C (`ICE_RISK_TEMP_C`) AND precipitation > 0 in the prior 24 h — advisory,
  conservative. `iceRiskMessage(shadedKm)` is always hedged ("Possible ice — ride like it's
  there"), calling out shaded stretches when present. `winterSpeedSettings(base, offset = 3)`
  drops every surface base speed by the studded-tyre offset (`STUDDED_OFFSET_KMH`), floored at
  `minKmh`. `shadedKm(analysis)` = km with `exposure ≤ 0.5` (`ICY_SHADE_EXPOSURE_MAX`) — shade/
  forest stretches thaw last.
- Weather adapter: optional `recentPrecipMm(p, hours)` — Open-Meteo `past_hours=24` +
  `hourly=precipitation`, summed; pure `parseRecentPrecipMm` exported and unit-tested. The mock
  provider implements it deterministically (2 mm in the 'shifting' fixture story, else 0); the
  planner treats an absent value as 0 rather than failing.
- `runPlan` wiring: winter mode swaps in studded `winterSpeedSettings`, defaults "home before
  dark" ON (both `scoreCandidates` and `scoreMatrix` read the effective flag — daylight remains
  the existing SCORING_SPEC §5 hard constraint; winter just flips its default), and computes a
  `WinterInfo { iceRisk, message, precip, minTempC }` from the coldest window hour plus
  `recentPrecipMm`. `PlanInputs.winter` and `PlanOutput.winter` added.
- UI: `resultsStore` carries `winter`; new `WinterCaution` component — the ice line is
  `role="alert"` only when risk is actually flagged, a plain informational note otherwise
  (avoids alert-spam on every winter ride). Shown on Results (top) and Ride (at start).
  `PlanScreen` gains a "Winter mode" toggle plus a temperature-based suggestion hint ("It's
  −2 °C — consider Winter mode…").
- **Important:** precipitation *type* is copy-only — temperature-inferred, since `WindSample` has
  no snowfall field to read directly. The rain sub-score itself is unchanged by this story; winter
  changes what the copy calls the precipitation (snow vs. rain), not how it's scored.
- Tests: `src/engine/winter.test.ts` (13) — `suggestWinter`, `precipType` (snow ≠ rain), an
  `it.each` `iceRisk` truth table, a caution-never-a-guarantee copy assertion,
  `winterSpeedSettings` (offset + floor + grade/wind coefficients left untouched), `shadedKm`, a
  daylight hard-constraint test at a Helsinki-December sunset (late ride eliminated, enough-
  daylight ride kept), and a combined golden winter-morning test (late start eliminated by
  daylight *and* the icy-morning flag fires). Full gate: 377 tests, lint clean, build OK.
- See **DEC-031** for the season-suggestion, ice-risk-heuristic, precip-type, studded-offset,
  daylight-default, shaded-stretch, and past-precip-adapter design decisions.
- Reviewed post-implementation by a substitute senior reviewer (Opus) — Fable 5 was out of usage
  credits this session; see follow-up review commit for findings/fixes.

**2026-07-18 — Substitute review (Opus, standing in for Fable 5 — out of credits) — fixes
applied.** Verdict: REQUEST-CHANGES; 3 MAJOR, 3 MINOR, 1 NIT — all fixed, gate green (388 tests,
lint clean, build OK).
- **M1 — golden fixture didn't test the wiring.** The winter tests only exercised
  `scoreCandidates` directly, never `runPlan`'s winter logic — flipping the daylight-force line
  would have broken nothing and no test would have noticed. Fixed: added `runPlan`-level winter
  integration tests (`src/state/plan/runPlan.test.ts`) proving `WinterInfo` is assembled in winter
  mode (and `null` otherwise), studded speeds make the *same* route slower, home-before-dark is
  **forced** on in winter even with the user toggle off (a too-long ride is rejected while an
  otherwise-identical non-winter run keeps it), and the ice-risk caution fires on a cold wet
  morning but not on a dry one.
- **M2 — new parser untested.** Added contract tests for `parseRecentPrecipMm` (windowed sum,
  nulls → 0, bare object, malformed → 0) and `OpenMeteoProvider.recentPrecipMm` (sums the prior
  24 h, not the forecast hour; 429 → quota) in `openMeteo.test.ts`.
- **M3 — DESIGN §1 colour.** The ice caution used `--head` (a wind/headwind hue) for a
  non-wind warning. Fixed: it now uses `--cross`, the defined "caution" hue.
- **m4 — studded no-op under the physics model.** `winterSpeedSettings` only touched `baseKmh`,
  which the physics model uses solely as a Newton seed, so physics-model ETAs wouldn't actually
  slow down in winter. Fixed: it now also raises rolling resistance (`crr × WINTER_CRR_MULT`,
  1.3), so studded-tyre ETAs are honestly slower under either speed model; added a test.
- **m5 — precip type read the wrong hour.** The "snow/rain likely" copy was inferred from hour 0
  regardless of when the ride actually starts. Fixed: precip type is now inferred at the
  **departure hour's** sample.
- **m6 — summed 25 hours instead of 24.** `past_hours=24` + `forecast_hours=1` returns 25 hourly
  entries; `parseRecentPrecipMm` now sums only the first `hours` entries (the past ones),
  excluding the trailing forecast hour.
- **NIT m7 — decorative glyph read aloud.** The decorative "❄" inside the `role="alert"` ice line
  is now wrapped in `aria-hidden`.
- See the DEC-031 review addendum in `docs/DECISIONS.md` for the design-level summary.
