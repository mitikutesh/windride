# WR-027 · Winter / Nordic mode
Epic: 4 · Signature | Status: TODO | Depends on: WR-020 | Size: M

## Goal
Make the app trustworthy in the season that defines Finland: ice-risk warnings, studded-tyre
speeds, and daylight as a hard constraint by default.

## Context (read first)
PRODUCT_SPEC §3 v0.4 · SCORING_SPEC §5 · WR-018 grid (shade proxy).

## Acceptance criteria
- [ ] Season detection (temp-based suggestion + manual toggle). Winter defaults: "home before
      dark" ON, studded-tyre speed offsets applied (settings), rain score replaced by
      precipitation-type awareness (snow ≠ rain in copy).
- [ ] Ice-risk heuristic: flag when min temp within ride window ≤ +1 °C AND precipitation in
      prior 24 h (needs past-hours params — extend WR-004, note API param); copy warns that
      shaded/forest roads stay icy longest (exposure ≤0.5 stretches listed).
- [ ] Heuristic is presented as a caution, never a guarantee ("possible ice — ride like it's
      there"); appears on results + ride start.
- [ ] Golden winter fixture: late start eliminated by daylight, icy-morning flag fires.

## Test contract
Heuristic truth-table tests; daylight hard-constraint tests at Helsinki December sunset.

## Out of scope
Road-maintenance feeds; friction modelling.

## Log
