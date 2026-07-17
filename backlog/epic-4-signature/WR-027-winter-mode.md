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
